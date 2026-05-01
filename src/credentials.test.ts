/**
 * Tests for credential file-fallback storage.
 * Keychain path is exercised in integration / manual testing — here we verify
 * the file fallback behavior and 0600 permissions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __internal, type Credential } from './credentials.js';

const FileStore = __internal.FileStore;

const testCred: Credential = {
  accessToken: 'access-tok',
  refreshToken: 'refresh-tok',
  phone: '+15551234567',
  displayName: 'Brian Butler',
  expiresAt: 1_750_000_000_000,
};

describe('FileStore', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hango-mcp-creds-'));
    path = join(dir, 'sub', 'credentials.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('save() creates the file with 0600 permissions', async () => {
    const store = new FileStore(path);
    await store.save(testCred);
    const s = await stat(path);
    if (process.platform !== 'win32') {
      // eslint-disable-next-line no-bitwise
      expect(s.mode & 0o777).toBe(0o600);
    }
    const loaded = await store.load();
    expect(loaded).toEqual(testCred);
  });

  it('save() rejects if file ends up with wrong permissions (POSIX)', async () => {
    if (process.platform === 'win32') return;
    // Pre-create file with wider permissions to simulate a hostile environment.
    const store = new FileStore(path);
    await store.save(testCred); // creates with 0600
    // Now manually loosen the perms; subsequent save() will chmod back to 0600.
    const { chmod } = await import('node:fs/promises');
    await chmod(path, 0o644);
    await store.save(testCred);
    const s = await stat(path);
    // eslint-disable-next-line no-bitwise
    expect(s.mode & 0o777).toBe(0o600);
  });

  it('load() returns null when file does not exist', async () => {
    const store = new FileStore(join(dir, 'never-existed.json'));
    expect(await store.load()).toBeNull();
  });

  it('clear() deletes the file', async () => {
    const store = new FileStore(path);
    await store.save(testCred);
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('load() returns null on malformed JSON', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(dir, 'sub'), { recursive: true });
    await writeFile(path, '{not json', 'utf8');
    const store = new FileStore(path);
    expect(await store.load()).toBeNull();
  });
});
