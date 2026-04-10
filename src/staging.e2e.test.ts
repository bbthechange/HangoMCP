/**
 * E2E smoke tests against the real API.
 *
 * Run:  npx vitest run --project e2e
 *
 * These hit real endpoints with real state. Hangouts created during tests
 * are cleaned up in afterAll. Skipped by default — only runs with --project e2e.
 *
 * Environment overrides:
 *   E2E_BASE_URL  — API base (default: production)
 *   E2E_PHONE     — test phone number
 *   E2E_PASSWORD  — test password
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// ─── Config ─────────────────────────────────────────────────────────────────

const BASE_URL = (
  process.env.E2E_BASE_URL ??
  'https://am6c8sp6kh.execute-api.us-west-2.amazonaws.com/prod'
).replace(/\/$/, '');

const PHONE = process.env.E2E_PHONE ?? '+19285251044';
const PASSWORD = process.env.E2E_PASSWORD ?? 'mypass2';
const TIMEZONE = 'America/Denver';

// ─── Shared state ───────────────────────────────────────────────────────────

let jwt = '';
let userId = '';
let displayName = '';
let firstGroupId = '';
const hangoutsToDelete: string[] = [];

// ─── Helpers ────────────────────────────────────────────────────────────────

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${jwt}`,
    'Content-Type': 'application/json',
    'X-App-Version': '2.1.0',
    'X-Client-Type': 'mobile',
  };
}

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { ...headers(), ...(opts.headers as Record<string, string> ?? {}) },
  });
  if (res.status === 204 || res.status === 304) return undefined as T;
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`${res.status} ${path}: ${JSON.stringify(body)}`);
  }
  return body as T;
}

// ─── Setup & Teardown ───────────────────────────────────────────────────────

beforeAll(async () => {
  // Authenticate
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber: PHONE, password: PASSWORD }),
  });
  const loginBody = await loginRes.json();
  if (!loginRes.ok) {
    throw new Error(`Login failed: ${JSON.stringify(loginBody)}`);
  }
  jwt = loginBody.accessToken;
  userId = loginBody.user.id;
  displayName = loginBody.user.displayName;

  // Pre-fetch first group so tests don't depend on ordering
  const groupsRes = await fetch(`${BASE_URL}/groups`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      'X-App-Version': '2.1.0',
      'X-Client-Type': 'mobile',
    },
  });
  const groups = await groupsRes.json();
  if (groupsRes.ok && Array.isArray(groups) && groups.length > 0) {
    firstGroupId = groups[0].groupId;
  }
});

afterAll(async () => {
  // Clean up any hangouts created during tests
  for (const id of hangoutsToDelete) {
    try {
      await fetch(`${BASE_URL}/hangouts/${id}`, {
        method: 'DELETE',
        headers: headers(),
      });
    } catch {
      // Best-effort cleanup
    }
  }
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('E2E staging smoke tests', () => {
  it('authenticates and gets profile', async () => {
    const profile = await api<{
      id: string;
      displayName: string;
      phoneNumber?: string;
    }>('/profile');

    expect(profile.id).toBe(userId);
    expect(profile.displayName).toBeTruthy();
    expect(typeof profile.id).toBe('string');
  });

  it('list_groups returns at least 1 group', async () => {
    const groups = await api<Array<{
      groupId: string;
      groupName: string;
    }>>('/groups');

    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups[0].groupId).toBeTruthy();
    expect(groups[0].groupName).toBeTruthy();

    // Store for later tests
    firstGroupId = groups[0].groupId;
  });

  it('get_group_feed returns feed for a known group', async () => {
    // Depends on previous test populating firstGroupId
    expect(firstGroupId).toBeTruthy();

    const feed = await api<{
      groupId: string;
      withDay: unknown[];
      needsDay: unknown[];
    }>(`/groups/${firstGroupId}/feed`);

    expect(feed.groupId).toBe(firstGroupId);
    expect(Array.isArray(feed.withDay)).toBe(true);
    expect(Array.isArray(feed.needsDay)).toBe(true);
  });

  it('create + RSVP + read a hangout (with cleanup)', async () => {
    expect(firstGroupId).toBeTruthy();

    // 1. Create hangout
    const created = await api<{
      hangoutId: string;
      title: string;
      version: number;
    }>('/hangouts', {
      method: 'POST',
      body: JSON.stringify({
        title: `E2E Smoke Test ${Date.now()}`,
        description: 'Automated test — safe to delete',
        associatedGroups: [firstGroupId],
        confirmed: false,
      }),
    });

    expect(created.hangoutId).toBeTruthy();
    hangoutsToDelete.push(created.hangoutId);

    // 2. RSVP as GOING
    await api(`/hangouts/${created.hangoutId}/interest`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'GOING' }),
    });

    // 3. Read hangout detail and verify RSVP
    const detail = await api<{
      hangout: { hangoutId: string; title: string };
      attendance: Array<{ userId: string; status: string }>;
    }>(`/hangouts/${created.hangoutId}`);

    expect(detail.hangout.hangoutId).toBe(created.hangoutId);
    expect(detail.hangout.title).toContain('E2E Smoke Test');

    const myRsvp = detail.attendance.find(
      (a) => a.userId === userId,
    );
    expect(myRsvp).toBeTruthy();
    expect(myRsvp!.status).toBe('GOING');
  });

  it('build_time round-trip via parseNaturalTime', async () => {
    // Import the local parser directly — this doesn't need the API
    const { parseNaturalTime } = await import('./time-parser.js');

    const result = parseNaturalTime('Saturday afternoon', TIMEZONE);

    expect(result.mode).toBe('fuzzy');
    expect(result.timeInfo.periodGranularity).toBe('afternoon');
    expect(result.humanReadable).toBeTruthy();
    expect(typeof result.humanReadable).toBe('string');
  });

  it('parse_event_url round-trip (no auth)', async () => {
    // This endpoint doesn't require authentication
    const res = await fetch(`${BASE_URL}/external/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://www.eventbrite.com' }),
    });

    // The endpoint may fail for invalid/generic URLs, but should respond
    expect(res.status).toBeLessThan(500);
  });
});
