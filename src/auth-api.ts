/**
 * Auth API client for hango-mcp.
 *
 * Endpoints (based on backend AuthController + the existing staging E2E test):
 *   POST /auth/login    { phoneNumber, password } → { accessToken, refreshToken, expiresIn?, user: { id, displayName, ... } }
 *   POST /auth/refresh  { refreshToken } → { accessToken, refreshToken? }
 *   POST /auth/logout   { refreshToken } → 204 (best-effort)
 *
 * NOTE: Refresh token rotation behavior wasn't confirmed with backend. We handle
 * both cases: if the refresh response includes a new refreshToken, we store it;
 * otherwise we keep the previous one.
 */

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number; // seconds
  user: {
    id: string;
    displayName?: string;
    username?: string;
    phoneNumber?: string;
  };
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

export interface AuthErrorBody {
  error?: string;
  message?: string;
}

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

const COMMON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-App-Version': '2.1.0',
  'X-Client-Type': 'mobile',
};

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

async function readJson(res: Response): Promise<unknown> {
  try { return await res.json(); } catch { return null; }
}

export async function login(
  baseUrl: string,
  phoneNumber: string,
  password: string,
): Promise<LoginResponse> {
  let res: Response;
  try {
    res = await fetch(joinUrl(baseUrl, '/auth/login'), {
      method: 'POST',
      headers: COMMON_HEADERS,
      body: JSON.stringify({ phoneNumber, password }),
    });
  } catch (cause) {
    throw new AuthError(0, 'NETWORK_ERROR', 'network', cause);
  }

  const body = (await readJson(res)) as (LoginResponse & AuthErrorBody) | null;

  if (!res.ok) {
    const code = body?.error ?? `HTTP_${res.status}`;
    const message = body?.message ?? code;
    throw new AuthError(res.status, code, message);
  }

  if (!body || !body.accessToken || !body.refreshToken || !body.user?.id) {
    throw new AuthError(res.status, 'BAD_LOGIN_RESPONSE', 'Login response was missing expected fields.');
  }
  return body;
}

export async function refresh(
  baseUrl: string,
  refreshToken: string,
): Promise<RefreshResponse> {
  let res: Response;
  try {
    res = await fetch(joinUrl(baseUrl, '/auth/refresh'), {
      method: 'POST',
      headers: COMMON_HEADERS,
      body: JSON.stringify({ refreshToken }),
    });
  } catch (cause) {
    throw new AuthError(0, 'NETWORK_ERROR', 'network', cause);
  }

  const body = (await readJson(res)) as (RefreshResponse & AuthErrorBody) | null;

  if (!res.ok) {
    const code = body?.error ?? `HTTP_${res.status}`;
    const message = body?.message ?? code;
    throw new AuthError(res.status, code, message);
  }
  if (!body || !body.accessToken) {
    throw new AuthError(res.status, 'BAD_REFRESH_RESPONSE', 'Refresh response was missing accessToken.');
  }
  return body;
}

/**
 * Best-effort logout — never throws. Returns true on apparent success.
 */
export async function logout(baseUrl: string, refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch(joinUrl(baseUrl, '/auth/logout'), {
      method: 'POST',
      headers: COMMON_HEADERS,
      body: JSON.stringify({ refreshToken }),
    });
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}
