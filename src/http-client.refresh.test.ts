/**
 * Tests for HttpClient automatic token refresh on 401.
 * Covers single-flight (mutex) behavior, refresh failure path, and credential clearing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient, HangoApiError, SESSION_EXPIRED_MESSAGE } from './http-client.js';
import type { CredentialStore, Credential } from './credentials.js';
import { fakeSessionContext } from './__helpers__/index.js';

function jsonResponse(status: number, body: unknown): Response {
  const h = new Headers({ 'content-type': 'application/json' });
  return new Response(JSON.stringify(body), { status, headers: h });
}

class FakeStore implements CredentialStore {
  saved: Credential | null = null;
  cleared = false;
  constructor(initial?: Credential) { this.saved = initial ?? null; }
  async load() { return this.saved; }
  async save(c: Credential) { this.saved = { ...c }; }
  async clear() { this.cleared = true; this.saved = null; }
  async describe() { return 'fake'; }
}

const initialCred: Credential = {
  accessToken: 'old-access',
  refreshToken: 'old-refresh',
  phone: '+15555550101',
  displayName: 'Test User',
  expiresAt: Date.now() + 3600_000,
};

describe('HttpClient — refresh on 401', () => {
  let store: FakeStore;
  let client: HttpClient;

  beforeEach(() => {
    store = new FakeStore(initialCred);
    client = new HttpClient(
      fakeSessionContext({ jwt: 'old-access', refreshToken: 'old-refresh' }),
      { store },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refreshes once on 401, retries the request, and persists the new token', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      // first call: 401 on /profile
      .mockResolvedValueOnce(jsonResponse(401, { error: 'TOKEN_EXPIRED' }))
      // refresh call → success
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 3600 }))
      // retry of /profile → success
      .mockResolvedValueOnce(jsonResponse(200, { id: 'u1', displayName: 'Test User' }));

    const result = await client.request<{ id: string }>('/profile');
    expect(result.id).toBe('u1');
    expect(spy).toHaveBeenCalledTimes(3);

    // Refresh URL was hit
    const refreshCall = spy.mock.calls[1];
    expect(String(refreshCall[0])).toContain('/auth/refresh');

    // Retry uses NEW token
    const retryHeaders = (spy.mock.calls[2][1] as RequestInit).headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe('Bearer new-access');

    // Store was updated with new tokens
    expect(store.saved?.accessToken).toBe('new-access');
    expect(store.saved?.refreshToken).toBe('new-refresh');
    expect(store.cleared).toBe(false);
  });

  it('preserves old refresh token if backend does not rotate it', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(401, { error: 'TOKEN_EXPIRED' }))
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'new-access', expiresIn: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'u1' }));

    await client.request('/profile');
    expect(store.saved?.refreshToken).toBe('old-refresh');
    expect(store.saved?.accessToken).toBe('new-access');
  });

  it('clears credential and throws session-expired when refresh fails', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(401, { error: 'TOKEN_EXPIRED' }))
      .mockResolvedValueOnce(jsonResponse(401, { error: 'INVALID_REFRESH_TOKEN' }));

    let thrown: unknown;
    try { await client.request('/profile'); } catch (e) { thrown = e; }

    expect(thrown).toBeInstanceOf(HangoApiError);
    const err = thrown as HangoApiError;
    expect(err.code).toBe('SESSION_EXPIRED');
    expect(err.message).toBe(SESSION_EXPIRED_MESSAGE);
    expect(store.cleared).toBe(true);
  });

  it('only runs ONE refresh when many 401s arrive concurrently (mutex)', async () => {
    let refreshCalls = 0;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/auth/refresh')) {
        refreshCalls += 1;
        await new Promise(r => setTimeout(r, 10));
        return jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 3600 });
      }
      // First time we see the path, return 401; afterwards return 200.
      // Track per-URL fail counts on the function itself.
      const counters = (spy as unknown as { __failed?: Set<string> });
      counters.__failed ??= new Set<string>();
      if (!counters.__failed.has(url)) {
        counters.__failed.add(url);
        return jsonResponse(401, { error: 'TOKEN_EXPIRED' });
      }
      return jsonResponse(200, { ok: true, url });
    });

    const results = await Promise.all([
      client.request('/a'),
      client.request('/b'),
      client.request('/c'),
    ]);
    expect(results).toHaveLength(3);
    expect(refreshCalls).toBe(1);
  });

  it('does NOT clear credential on transient network error during refresh', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(401, { error: 'TOKEN_EXPIRED' }))
      .mockRejectedValueOnce(new Error('socket hang up'));

    let thrown: HangoApiError | null = null;
    try { await client.request('/profile'); } catch (e) { thrown = e as HangoApiError; }
    expect(thrown).toBeInstanceOf(HangoApiError);
    expect(thrown?.code).toBe('NETWORK_ERROR');
    expect(store.cleared).toBe(false);
    expect(store.saved?.refreshToken).toBe('old-refresh');
  });

  it('emits exact UX-doc message on session expiry', () => {
    expect(SESSION_EXPIRED_MESSAGE).toBe(
      'Your Hango session expired. Run `npx hango-mcp login` to reconnect.',
    );
  });
});
