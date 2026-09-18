// Token storage + auth headers. The JWT is issued by the marketing_control
// backend but is a first-class ANDROMEDA session (shared secret + tables).

const TOKEN_KEY = 'andromeda-sales-token';
const USER_KEY = 'andromeda-sales-user';

export type Role = 'sysadmin' | 'admin' | 'guest';

export interface StoredUser {
  username: string;
  role: Role;
  displayName?: string | null;
  expiresAt: number;
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser(): StoredUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw) as StoredUser;
    if (user.expiresAt && user.expiresAt * 1000 < Date.now()) {
      clearAuth();
      return null;
    }
    return user;
  } catch {
    return null;
  }
}

export function setAuth(token: string, user: StoredUser): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* private mode — ignore */
  }
}

export function clearAuth(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function isWriteRole(role: Role | undefined | null): boolean {
  return role === 'admin' || role === 'sysadmin';
}
