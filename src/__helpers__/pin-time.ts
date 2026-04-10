/**
 * Test helper to pin Luxon's "now" to a fixed point in time.
 * Use in tests that depend on DateTime.now() for deterministic results.
 */

import { Settings } from 'luxon';
import { afterEach } from 'vitest';

/**
 * Pin DateTime.now() to the given ISO string for the duration of the test.
 * Automatically restores after each test via vitest's afterEach.
 *
 * @example
 *   pinTime('2025-03-15T10:00:00-07:00');
 *   // DateTime.now() now returns that fixed instant
 */
export function pinTime(iso: string): void {
  Settings.now = () => new Date(iso).getTime();
}

/** Restore real time. Called automatically if using pinTime in a describe block with afterEach. */
export function restoreTime(): void {
  Settings.now = () => Date.now();
}

/** Auto-restore after each test. Call once at the top of a describe block. */
export function usePinnedTime(): void {
  afterEach(() => {
    restoreTime();
  });
}
