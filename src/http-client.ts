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

import type { NormalizedError, SessionContext } from './types.js';

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
  private readonly jwt: string;

  constructor(ctx: SessionContext) {
    this.baseUrl = ctx.baseUrl.replace(/\/$/, '');
    this.jwt = ctx.jwt;
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

  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const method = opts.method ?? 'GET';
    const headers = this.buildHeaders(opts.headers);
    const body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

    const doFetch = async (): Promise<Response> => {
      return fetch(url, { method, headers, body });
    };

    let response = await doFetch();

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

    // Retry on 429
    if (response.status === 429) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      response = await fetch(url, { method: 'GET', headers });
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
