/**
 * Fake SessionContext builder for tests that need session data.
 */

import type { SessionContext } from '../types.js';

const DEFAULTS: SessionContext = {
  jwt: 'test-jwt-token',
  userId: 'user-001',
  displayName: 'Test User',
  timezone: 'America/Los_Angeles',
  baseUrl: 'https://test.example.com/prod/',
};

export function fakeSessionContext(overrides?: Partial<SessionContext>): SessionContext {
  return { ...DEFAULTS, ...overrides };
}
