/**
 * Tests for the auth-api module: login, refresh, logout request shapes & error mapping.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { login, refresh, logout, AuthError } from './auth-api.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const BASE = 'https://api.example.com/prod';

describe('auth-api', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('login', () => {
    it('POSTs phone+password and returns parsed body on success', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(200, {
          accessToken: 'a',
          refreshToken: 'r',
          user: { id: 'u1', displayName: 'Test' },
        }),
      );
      const out = await login(BASE, '+15555550101', 'pass');
      expect(out.accessToken).toBe('a');
      expect(out.refreshToken).toBe('r');
      expect(out.user.id).toBe('u1');
      const init = spy.mock.calls[0][1] as RequestInit;
      expect(init.method).toBe('POST');
      expect(init.body).toBe(JSON.stringify({ phoneNumber: '+15555550101', password: 'pass' }));
    });

    it('throws AuthError(NETWORK_ERROR) on fetch failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'));
      await expect(login(BASE, '+1', 'p')).rejects.toMatchObject({
        name: 'AuthError',
        code: 'NETWORK_ERROR',
      });
    });

    it('throws AuthError with backend code on 401', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(401, { error: 'INVALID_CREDENTIALS', message: 'wrong password' }),
      );
      let thrown: AuthError | null = null;
      try { await login(BASE, '+1', 'p'); } catch (e) { thrown = e as AuthError; }
      expect(thrown).toBeInstanceOf(AuthError);
      expect(thrown?.status).toBe(401);
      expect(thrown?.code).toBe('INVALID_CREDENTIALS');
    });

    it('throws BAD_LOGIN_RESPONSE if expected fields missing', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, {}));
      await expect(login(BASE, '+1', 'p')).rejects.toMatchObject({ code: 'BAD_LOGIN_RESPONSE' });
    });
  });

  describe('refresh', () => {
    it('POSTs the refresh token', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(200, { accessToken: 'new-a' }),
      );
      const out = await refresh(BASE, 'old-refresh');
      expect(out.accessToken).toBe('new-a');
      const init = spy.mock.calls[0][1] as RequestInit;
      expect(init.body).toBe(JSON.stringify({ refreshToken: 'old-refresh' }));
    });

    it('throws on missing accessToken', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, {}));
      await expect(refresh(BASE, 'r')).rejects.toMatchObject({ code: 'BAD_REFRESH_RESPONSE' });
    });
  });

  describe('logout', () => {
    it('returns true on 204', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
      expect(await logout(BASE, 'r')).toBe(true);
    });

    it('returns false on network error (best-effort, never throws)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'));
      expect(await logout(BASE, 'r')).toBe(false);
    });

    it('returns false on 500 (best-effort)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(500, { error: 'oops' }));
      expect(await logout(BASE, 'r')).toBe(false);
    });
  });
});
