/**
 * Credential storage for hango-mcp.
 *
 * Primary: OS keychain via @napi-rs/keyring. Service `hango-mcp`, account = phone.
 * Fallback: JSON file at platform-appropriate path with 0600 permissions.
 *
 * Stored fields: accessToken, refreshToken, phone, displayName, expiresAt.
 * Never stores the password.
 */

import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const SERVICE = 'hango-mcp';
// We use a fixed account name in the keychain because we don't know the phone
// until *after* we read the credential. The phone is stored in the JSON payload.
const KEYCHAIN_ACCOUNT = 'default';

export interface Credential {
  accessToken: string;
  refreshToken: string;
  phone: string;
  displayName: string;
  expiresAt: number; // unix ms
}

interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
}

interface KeyringModule {
  Entry: new (service: string, account: string) => KeyringEntry;
}

let keyringModule: KeyringModule | null | undefined;
async function loadKeyring(): Promise<KeyringModule | null> {
  if (keyringModule !== undefined) return keyringModule;
  try {
    const mod = (await import('@napi-rs/keyring')) as unknown as KeyringModule;
    keyringModule = mod;
  } catch {
    keyringModule = null;
  }
  return keyringModule;
}

async function getKeychainEntry(): Promise<KeyringEntry | null> {
  const mod = await loadKeyring();
  if (!mod) return null;
  try {
    return new mod.Entry(SERVICE, KEYCHAIN_ACCOUNT);
  } catch {
    return null;
  }
}

async function fileFallbackPath(): Promise<string> {
  // env-paths not strictly required, but use it when available for parity with spec.
  try {
    const envPaths = (await import('env-paths')).default as (
      name: string,
      opts?: { suffix?: string },
    ) => { config: string };
    return join(envPaths('hango-mcp', { suffix: '' }).config, 'credentials.json');
  } catch {
    // Fallback to ~/.config or %APPDATA% manually
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
      return join(appData, 'hango-mcp', 'credentials.json');
    }
    const xdg = process.env.XDG_CONFIG_HOME ?? join(home, '.config');
    return join(xdg, 'hango-mcp', 'credentials.json');
  }
}

export interface CredentialStore {
  load(): Promise<Credential | null>;
  save(cred: Credential): Promise<void>;
  clear(): Promise<void>;
  /** Where this store actually persisted ('keychain' or absolute file path). */
  describe(): Promise<string>;
}

class KeychainStore implements CredentialStore {
  async load(): Promise<Credential | null> {
    const entry = await getKeychainEntry();
    if (!entry) return null;
    try {
      const raw = entry.getPassword();
      if (!raw) return null;
      return JSON.parse(raw) as Credential;
    } catch {
      return null;
    }
  }

  async save(cred: Credential): Promise<void> {
    const entry = await getKeychainEntry();
    if (!entry) throw new Error('Keychain unavailable');
    entry.setPassword(JSON.stringify(cred));
  }

  async clear(): Promise<void> {
    const entry = await getKeychainEntry();
    if (!entry) return;
    try { entry.deletePassword(); } catch { /* ignore */ }
  }

  async describe(): Promise<string> { return 'keychain'; }
}

class FileStore implements CredentialStore {
  constructor(private readonly path: string) {}

  async load(): Promise<Credential | null> {
    try {
      const raw = await readFile(this.path, 'utf8');
      return JSON.parse(raw) as Credential;
    } catch {
      return null;
    }
  }

  async save(cred: Credential): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    // Write with 0600 from the start. writeFile honors `mode` only if file is created;
    // explicitly chmod to be defensive on existing files.
    await writeFile(this.path, JSON.stringify(cred, null, 2), { mode: 0o600 });
    await chmod(this.path, 0o600);
    if (process.platform !== 'win32') {
      const s = await stat(this.path);
      // eslint-disable-next-line no-bitwise
      const perm = s.mode & 0o777;
      if (perm !== 0o600) {
        throw new Error(
          `Credential file permissions are ${perm.toString(8)}, expected 600. Refusing to use it.`,
        );
      }
    }
  }

  async clear(): Promise<void> {
    if (existsSync(this.path)) {
      try { await unlink(this.path); } catch { /* ignore */ }
    }
  }

  async describe(): Promise<string> { return this.path; }
}

/**
 * Composite store: write/read prefers keychain, falls back to file.
 * On save, if keychain throws, we fall back to file (and warn caller via callback).
 */
export class CredentialStorage implements CredentialStore {
  private fileStore: FileStore | null = null;
  private fileStoreReady: Promise<FileStore> | null = null;

  constructor(private readonly onFallback?: (path: string) => void) {}

  private async getFile(): Promise<FileStore> {
    if (this.fileStore) return this.fileStore;
    if (!this.fileStoreReady) {
      this.fileStoreReady = (async () => {
        const path = await fileFallbackPath();
        this.fileStore = new FileStore(path);
        return this.fileStore;
      })();
    }
    return this.fileStoreReady;
  }

  async load(): Promise<Credential | null> {
    const kc = new KeychainStore();
    try {
      const fromKc = await kc.load();
      if (fromKc) return fromKc;
    } catch { /* fall through */ }
    const f = await this.getFile();
    return f.load();
  }

  async save(cred: Credential): Promise<void> {
    const kc = new KeychainStore();
    try {
      await kc.save(cred);
      return;
    } catch {
      const f = await this.getFile();
      this.onFallback?.(await f.describe());
      await f.save(cred);
    }
  }

  async clear(): Promise<void> {
    const kc = new KeychainStore();
    try { await kc.clear(); } catch { /* ignore */ }
    const f = await this.getFile();
    await f.clear();
  }

  async describe(): Promise<string> {
    const kc = new KeychainStore();
    const fromKc = await kc.load().catch(() => null);
    if (fromKc) return 'keychain';
    const f = await this.getFile();
    if (await f.load()) return await f.describe();
    return 'keychain';
  }
}

// Re-export helpers for tests / advanced use.
export const __internal = { fileFallbackPath, FileStore, KeychainStore };
