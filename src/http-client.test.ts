/**
 * Tests for HttpClient — retry logic, error normalization, auth headers, status handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient, HangoApiError } from './http-client.js';
import { fakeSessionContext } from './__helpers__/index.js';

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  const h = new Headers(headers);
  h.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers: h });
}

function emptyResponse(status: number, headers?: Record<string, string>): Response {
  return new Response(null, { status, headers });
}

describe('HttpClient', () => {
  let client: HttpClient;
  const ctx = fakeSessionContext();

  beforeEach(() => {
    client = new HttpClient(ctx);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ─── Auth header presence ────────────────────────────────────────────────

  describe('request() — auth headers', () => {
    it('includes Authorization and standard headers', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(200, { ok: true }),
      );

      await client.request('/test');

      expect(spy).toHaveBeenCalledOnce();
      const [, opts] = spy.mock.calls[0]!;
      const headers = opts!.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-jwt-token');
      expect(headers['X-App-Version']).toBe('2.1.0');
      expect(headers['X-Client-Type']).toBe('mobile');
      expect(headers['Content-Type']).toBe('application/json');
    });
  });

  describe('requestNoAuth() — no auth header', () => {
    it('does not include Authorization header', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(200, { title: 'Event' }),
      );

      await client.requestNoAuth('/external/parse', { method: 'POST', body: { url: 'https://example.com' } });

      const [, opts] = spy.mock.calls[0]!;
      const headers = opts!.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
      expect(headers['Content-Type']).toBe('application/json');
    });
  });

  // ─── 409 conflict retry ──────────────────────────────────────────────────

  describe('409 conflict retry', () => {
    it('retries once on VERSION_CONFLICT and returns retry response', async () => {
      const spy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse(409, { error: 'VERSION_CONFLICT', message: 'Conflict' }))
        .mockResolvedValueOnce(jsonResponse(200, { result: 'ok' }));

      const data = await client.request('/test', { method: 'PUT' });
      expect(data).toEqual({ result: 'ok' });
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('retries once on TRANSACTION_FAILED', async () => {
      const spy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse(409, { error: 'TRANSACTION_FAILED', message: 'TXN fail' }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      await client.request('/test', { method: 'POST' });
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('throws on 409 with non-retryable error code', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(409, { error: 'DUPLICATE_ENTRY', message: 'Already exists' }),
      );

      try {
        await client.request('/test');
        expect.unreachable('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(HangoApiError);
        expect((err as HangoApiError).message).toBe('Already exists');
      }
    });
  });

  // ─── 429 backoff ─────────────────────────────────────────────────────────

  describe('429 rate limit backoff', () => {
    it('waits 5 seconds then retries once', async () => {
      const spy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse(429, { error: 'RATE_LIMITED', message: 'Too many requests' }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      const promise = client.request('/test');

      // Advance past the 5s wait
      await vi.advanceTimersByTimeAsync(5000);

      const result = await promise;
      expect(result).toEqual({ ok: true });
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  // ─── Error messages ──────────────────────────────────────────────────────

  describe('conversational error messages', () => {
    it('401 returns session expired message', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(401, { error: 'UNAUTHORIZED' }),
      );

      await expect(client.request('/test')).rejects.toThrow(
        'Your session has expired. Please log in via the app.',
      );
    });

    it('403 returns access denied message', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(403, { error: 'FORBIDDEN' }),
      );

      await expect(client.request('/test')).rejects.toThrow(
        "You don't have access to that.",
      );
    });

    it('404 returns not found with message', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(404, { error: 'NOT_FOUND', message: 'Hangout not found' }),
      );

      await expect(client.request('/test')).rejects.toThrow('Not found: Hangout not found');
    });

    it('500 returns server error message', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(500, { error: 'INTERNAL_ERROR', message: 'DB down' }),
      );

      await expect(client.request('/test')).rejects.toThrow(
        'Something went wrong on the server. Try again, or check in the app.',
      );
    });

    it('error includes correct status and code on HangoApiError', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(403, { error: 'FORBIDDEN', message: 'Not allowed' }),
      );

      try {
        await client.request('/test');
        expect.unreachable('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(HangoApiError);
        expect((err as HangoApiError).status).toBe(403);
        expect((err as HangoApiError).code).toBe('FORBIDDEN');
      }
    });
  });

  // ─── 204 / 304 handling ──────────────────────────────────────────────────

  describe('204 No Content', () => {
    it('request() returns undefined for 204', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(emptyResponse(204));

      const result = await client.request('/test', { method: 'DELETE' });
      expect(result).toBeUndefined();
    });

    it('requestNoAuth() returns undefined for 204', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(emptyResponse(204));

      const result = await client.requestNoAuth('/test');
      expect(result).toBeUndefined();
    });
  });

  describe('304 Not Modified', () => {
    it('request() returns undefined for 304', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(emptyResponse(304));

      const result = await client.request('/test');
      expect(result).toBeUndefined();
    });
  });

  // ─── getWithEtag ─────────────────────────────────────────────────────────

  describe('getWithEtag()', () => {
    it('sends If-None-Match header when etag provided', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(200, { items: [] }, { etag: '"new-etag"' }),
      );

      await client.getWithEtag('/feed', '"old-etag"');

      const [, opts] = spy.mock.calls[0]!;
      const headers = opts!.headers as Record<string, string>;
      expect(headers['If-None-Match']).toBe('"old-etag"');
    });

    it('returns notModified: true for 304', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(emptyResponse(304));

      const result = await client.getWithEtag('/feed', '"etag-abc"');
      expect(result.notModified).toBe(true);
      expect(result.data).toBeNull();
      expect(result.etag).toBe('"etag-abc"');
    });

    it('returns data and etag for 200', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(200, { items: [1, 2] }, { etag: '"fresh"' }),
      );

      const result = await client.getWithEtag('/feed');
      expect(result.notModified).toBe(false);
      expect(result.data).toEqual({ items: [1, 2] });
      expect(result.etag).toBe('"fresh"');
    });

    it('retries on 429 with 5s delay', async () => {
      const spy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse(429, { error: 'RATE_LIMITED' }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }, { etag: '"retry-etag"' }));

      const promise = client.getWithEtag('/feed');
      await vi.advanceTimersByTimeAsync(5000);
      const result = await promise;

      expect(result.data).toEqual({ ok: true });
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('throws on error responses', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(500, { error: 'SERVER_ERROR', message: 'boom' }),
      );

      await expect(client.getWithEtag('/feed')).rejects.toThrow(HangoApiError);
    });
  });

  // ─── URL construction ────────────────────────────────────────────────────

  describe('URL construction', () => {
    it('strips trailing slash from baseUrl', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, {}));

      await client.request('/path');
      const [url] = spy.mock.calls[0]!;
      expect(url).toBe('https://test.example.com/prod/path');
    });
  });
});
