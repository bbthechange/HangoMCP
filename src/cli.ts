/**
 * hango-mcp CLI subcommands: login, logout, status.
 *
 * Copy is sourced verbatim from ux/MCP_AUTH_UX.md Phase 1.
 */

import { input, password as passwordPrompt } from '@inquirer/prompts';
import { login as apiLogin, logout as apiLogout, AuthError } from './auth-api.js';
import { CredentialStorage, type Credential } from './credentials.js';

// Keep a slightly conservative TTL guess if backend doesn't return expiresIn.
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

function normalizePhone(raw: string): string {
  // Strip whitespace, parens, dashes; ensure leading +.
  let p = raw.trim().replace(/[\s()\-.]/g, '');
  if (!p.startsWith('+')) p = `+${p}`;
  return p;
}

/**
 * Map auth errors to the exact UX-doc-mandated copy.
 */
function loginErrorMessage(err: unknown): { message: string; recoverable: boolean } {
  if (err instanceof AuthError) {
    if (err.status === 0 || err.code === 'NETWORK_ERROR') {
      return {
        message: '✗ Couldn\'t reach Hango servers. Check your connection and try again.',
        recoverable: true,
      };
    }
    const code = (err.code ?? '').toUpperCase();
    const msg = (err.message ?? '').toLowerCase();
    // Heuristics for backend error codes — matched by status + code/message.
    if (err.status === 401 || code.includes('INVALID_CREDENTIAL') || code.includes('UNAUTHORIZED')
        || msg.includes('incorrect') || msg.includes('invalid')) {
      return { message: '✗ Login failed: incorrect phone or password. Try again.', recoverable: true };
    }
    if (code.includes('NOT_VERIFIED') || code.includes('UNVERIFIED') || msg.includes('verif')) {
      return {
        message: '✗ Your account isn\'t verified yet. Open the Hango app and complete phone verification, then try again.',
        recoverable: false,
      };
    }
    if (err.status === 404 || code.includes('NOT_FOUND') || msg.includes('no account') || msg.includes('does not exist')) {
      return {
        message: '✗ No Hango account for that number. Create one in the Hango app first, then come back.',
        recoverable: false,
      };
    }
    return { message: `✗ Login failed: ${err.message}`, recoverable: true };
  }
  return {
    message: '✗ Couldn\'t reach Hango servers. Check your connection and try again.',
    recoverable: true,
  };
}

export interface CliOptions {
  baseUrl: string;
}

export async function runLogin(opts: CliOptions): Promise<number> {
  process.stdout.write("Welcome to Hango. Let's connect your account.\n\n");

  let fallbackPath: string | null = null;
  const store = new CredentialStorage((path) => { fallbackPath = path; });

  // Loop on recoverable errors (wrong creds, network); exit on fatal ones.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let phone: string;
    let pwd: string;
    try {
      phone = normalizePhone(await input({
        message: 'Phone number:',
        validate: (v: string) => v.trim().length > 0 || 'Phone number is required.',
      }));
      pwd = await passwordPrompt({
        message: 'Password:',
        mask: '*',
      });
    } catch {
      // User hit Ctrl-C or similar.
      return 1;
    }

    try {
      const resp = await apiLogin(opts.baseUrl, phone, pwd);
      const expiresAt = resp.expiresIn
        ? Date.now() + resp.expiresIn * 1000
        : Date.now() + DEFAULT_ACCESS_TOKEN_TTL_SECONDS * 1000;
      const cred: Credential = {
        accessToken: resp.accessToken,
        refreshToken: resp.refreshToken,
        phone,
        displayName: resp.user.displayName ?? resp.user.username ?? '',
        expiresAt,
      };
      // CredentialStorage handles keychain → file fallback internally and invokes
      // the onFallback callback to report the file path. Any error here means even
      // the file fallback failed (e.g., disk full, permission denied).
      await store.save(cred);

      process.stdout.write(`\n✓ Logged in as ${cred.displayName}\n`);
      if (fallbackPath) {
        process.stderr.write(
          `✗ Couldn't save credential to keychain. Falling back to ${fallbackPath} (chmod 600).\n`,
        );
      } else {
        process.stdout.write('✓ Credential saved to system keychain\n');
      }
      process.stdout.write('\nYou\'re all set. Restart your AI assistant to start using Hango.\n');
      return 0;
    } catch (err) {
      const { message, recoverable } = loginErrorMessage(err);
      process.stderr.write(`${message}\n`);
      if (!recoverable) return 1;
      // recoverable → loop and re-prompt
      process.stderr.write('\n');
    }
  }
}

export async function runLogout(opts: CliOptions): Promise<number> {
  const store = new CredentialStorage();
  const cred = await store.load();
  if (cred?.refreshToken) {
    // Best-effort backend revoke. Never blocks logout.
    await apiLogout(opts.baseUrl, cred.refreshToken).catch(() => false);
  }
  await store.clear();
  process.stdout.write('✓ Logged out. Your AI assistant can no longer access Hango.\n');
  return 0;
}

function formatExpiry(expiresAt: number): string {
  const now = Date.now();
  const diffMs = expiresAt - now;
  if (diffMs <= 0) return 'expired (will refresh on next call)';
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'less than a minute';
  if (minutes === 1) return '1 minute';
  if (minutes < 90) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

export async function runStatus(_opts: CliOptions): Promise<number> {
  const store = new CredentialStorage();
  const cred = await store.load();
  if (!cred) {
    process.stdout.write('Not logged in. Run `npx hango-mcp login` to connect.\n');
    return 0;
  }
  const name = cred.displayName || 'unknown';
  const phone = cred.phone || 'unknown';
  process.stdout.write(`Logged in as ${name} (${phone})\n`);
  process.stdout.write(`Token expires in ${formatExpiry(cred.expiresAt)} (auto-refreshes)\n`);
  return 0;
}
