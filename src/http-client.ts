/**
 * HTTP client with shared auth headers, retry logic, and error normalization.
 *
 * Error shapes from the API:
 *   Shape A (most endpoints): {error, message, timestamp}
 *   Shape B (auth/profile):   {error}
 *   Shape C (rate limiting):  {error, message} (no timestamp)
 *
 * Retry policy:
 *   409 VERSION_CONFLICT/TRANSACTION_FAILED → retry once
 *   429 → wait 5s, retry once
 *   401 → "Your session has expired. Please log in via the app."
 *   403 → "You don't have access to that."
 *   500 → "Something went wrong on the server. Try again, or check in the app."
 */

import { refresh as refreshTokens, AuthError } from './auth-api.js';
import type { CredentialStore, Credential } from './credentials.js';
import type { NormalizedError, SessionContext } from './types.js';

/** Exact UX-doc-mandated error message when refresh fails permanently. */
export const SESSION_EXPIRED_MESSAGE =
  'Your Hango session expired. Run `npx hango-mcp login` to reconnect.';

export interface AuthRefreshHooks {
  /** Persist updated credential after a successful refresh. */
  store: CredentialStore;
  /** Called when refresh fails irrecoverably. The store is cleared first. */
  onRefreshFailure?: () => void;
}

export class HangoApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HangoApiError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

function normalizeApiError(status: number, body: unknown): NormalizedError {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    // Shape A: {error, message, timestamp}
    // Shape B: {error}
    // Shape C: {error, message} (no timestamp)
    const code = typeof b.error === 'string' ? b.error : `HTTP_${status}`;
    const message = typeof b.message === 'string' ? b.message : code;
    return { status, code, message };
  }
  return { status, code: `HTTP_${status}`, message: `Request failed with status ${status}` };
}

function toConversationalMessage(err: NormalizedError): string {
  switch (err.status) {
    case 401:
      return 'Your session has expired. Please log in via the app.';
    case 403:
      return "You don't have access to that.";
    case 404:
      return `Not found: ${err.message}`;
    case 429:
      return 'Too many requests. Please wait a moment.';
    default:
      if (err.status >= 500) {
        return 'Something went wrong on the server. Try again, or check in the app.';
      }
      return err.message;
  }
}

function isRetryableConflict(body: unknown): boolean {
  if (body && typeof body === 'object') {
    const code = (body as Record<string, unknown>).error;
    return code === 'VERSION_CONFLICT' || code === 'TRANSACTION_FAILED';
  }
  return false;
}

export class HttpClient {
  private readonly baseUrl: string;
  private jwt: string;
  private refreshToken: string | null;
  private readonly auth: AuthRefreshHooks | null;
  private inFlightRefresh: Promise<string> | null = null;

  constructor(ctx: SessionContext, auth?: AuthRefreshHooks) {
    this.baseUrl = ctx.baseUrl.replace(/\/$/, '');
    this.jwt = ctx.jwt;
    this.refreshToken = ctx.refreshToken ?? null;
    this.auth = auth ?? null;
  }

  /** Replace the access token in-place. Used after login or refresh. */
  setTokens(accessToken: string, refreshToken?: string): void {
    this.jwt = accessToken;
    if (refreshToken !== undefined) this.refreshToken = refreshToken;
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.jwt}`,
      'X-App-Version': '2.1.0',
      'X-Client-Type': 'mobile',
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  /**
   * Attempt to refresh the access token. Concurrent callers share a single
   * in-flight refresh promise (mutex), so only ONE refresh ever runs at a time.
   * On permanent failure, clears stored credentials and throws the
   * UX-mandated session-expired error.
   */
  private async attemptRefresh(): Promise<string> {
    if (this.inFlightRefresh) return this.inFlightRefresh;
    if (!this.auth || !this.refreshToken) {
      throw new HangoApiError(401, 'NOT_LOGGED_IN', SESSION_EXPIRED_MESSAGE);
    }
    const rt = this.refreshToken;
    const store = this.auth.store;
    this.inFlightRefresh = (async () => {
      try {
        const resp = await refreshTokens(this.baseUrl, rt);
        // Load existing credential to preserve phone/displayName.
        const existing = (await store.load()) ?? null;
        const newRefresh = resp.refreshToken ?? rt;
        const expiresAt = resp.expiresIn
          ? Date.now() + resp.expiresIn * 1000
          : Date.now() + 60 * 60 * 1000; // default 1h
        const updated: Credential = {
          accessToken: resp.accessToken,
          refreshToken: newRefresh,
          phone: existing?.phone ?? '',
          displayName: existing?.displayName ?? '',
          expiresAt,
        };
        await store.save(updated);
        this.setTokens(resp.accessToken, newRefresh);
        return resp.accessToken;
      } catch (err) {
        // Distinguish transient network failure from a true auth rejection.
        // Only true rejection should clear the credential and force a re-login;
        // a transient blip should bubble up as a normal error so the next request retries.
        const isTransient =
          err instanceof AuthError && (err.status === 0 || err.code === 'NETWORK_ERROR');
        if (isTransient) {
          throw new HangoApiError(0, 'NETWORK_ERROR', 'Network error during token refresh.');
        }
        // Permanent failure: clear credential FIRST, then throw the UX message.
        try { await store.clear(); } catch { /* ignore */ }
        this.auth?.onRefreshFailure?.();
        throw new HangoApiError(401, 'SESSION_EXPIRED', SESSION_EXPIRED_MESSAGE);
      } finally {
        this.inFlightRefresh = null;
      }
    })();
    return this.inFlightRefresh;
  }

  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const method = opts.method ?? 'GET';
    const body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

    const doFetch = async (): Promise<Response> => {
      return fetch(url, { method, headers: this.buildHeaders(opts.headers), body });
    };

    let response = await doFetch();

    // Refresh-on-401: attempt refresh once, then retry the original request.
    if (response.status === 401 && this.auth) {
      try {
        await this.attemptRefresh();
        response = await doFetch();
      } catch (err) {
        if (err instanceof HangoApiError) throw err;
        throw err;
      }
    }

    // Retry on 409 conflict (once)
    if (response.status === 409) {
      const respBody = await response.json().catch(() => null);
      if (isRetryableConflict(respBody)) {
        response = await doFetch();
      } else {
        const err = normalizeApiError(409, respBody);
        throw new HangoApiError(err.status, err.code, toConversationalMessage(err));
      }
    }

    // Retry on 429 (wait 5s, once)
    if (response.status === 429) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      response = await doFetch();
    }

    // Handle error responses
    if (!response.ok && response.status !== 304) {
      const respBody = await response.json().catch(() => null);
      const err = normalizeApiError(response.status, respBody);
      throw new HangoApiError(err.status, err.code, toConversationalMessage(err));
    }

    // 204 No Content or 304 Not Modified
    if (response.status === 204 || response.status === 304) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  /**
   * Make a request WITHOUT authentication headers.
   * Used for endpoints like /external/parse that don't require auth.
   */
  async requestNoAuth<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const method = opts.method ?? 'GET';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...opts.headers,
    };
    const body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

    const response = await fetch(url, { method, headers, body });

    if (!response.ok) {
      const respBody = await response.json().catch(() => null);
      const err = normalizeApiError(response.status, respBody);
      throw new HangoApiError(err.status, err.code, toConversationalMessage(err));
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  /**
   * GET with ETag support. Returns { data, etag, notModified }.
   */
  async getWithEtag<T>(
    path: string,
    ifNoneMatch?: string,
  ): Promise<{ data: T | null; etag: string | null; notModified: boolean }> {
    const url = `${this.baseUrl}${path}`;
    const headers = this.buildHeaders(
      ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : undefined,
    );

    let response = await fetch(url, { method: 'GET', headers });

    // Refresh-on-401 with retry
    if (response.status === 401 && this.auth) {
      await this.attemptRefresh();
      const retryHeaders = this.buildHeaders(
        ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : undefined,
      );
      response = await fetch(url, { method: 'GET', headers: retryHeaders });
    }

    // Retry on 429
    if (response.status === 429) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      response = await fetch(url, { method: 'GET', headers: this.buildHeaders(
        ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : undefined,
      ) });
    }

    if (response.status === 304) {
      return { data: null, etag: ifNoneMatch ?? null, notModified: true };
    }

    if (!response.ok) {
      const respBody = await response.json().catch(() => null);
      const err = normalizeApiError(response.status, respBody);
      throw new HangoApiError(err.status, err.code, toConversationalMessage(err));
    }

    const etag = response.headers.get('etag');
    const data = (await response.json()) as T;
    return { data, etag, notModified: false };
  }
}
