import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { clearAuth, getStoredUser, isWriteRole, setAuth, type Role, type StoredUser } from './auth';
import * as api from './api';

interface AuthCtx {
  user: StoredUser | null;
  role: Role | null;
  canWrite: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StoredUser | null>(() => getStoredUser());

  const signIn = useCallback(async (username: string, password: string) => {
    const r = await api.login(username, password);
    const stored: StoredUser = { username: r.username, role: r.role, displayName: r.displayName, expiresAt: r.expiresAt };
    setAuth(r.token, stored);
    setUser(stored);
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    clearAuth();
    setUser(null);
  }, []);

  const value = useMemo<AuthCtx>(() => ({
    user,
    role: user?.role ?? null,
    canWrite: isWriteRole(user?.role),
    signIn,
    signOut,
  }), [user, signIn, signOut]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
