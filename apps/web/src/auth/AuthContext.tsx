import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { CurrentUser, Permission } from '@slc/shared';

import { ApiClientError, authApi } from '../lib/api';

type AuthStatus = 'initializing' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: CurrentUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** UX-only permission check. The backend remains authoritative. */
  can: (permission: Permission) => boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('initializing');
  const [user, setUser] = useState<CurrentUser | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { user: current } = await authApi.me();
      if (current) {
        setUser(current);
        setStatus('authenticated');
      } else {
        setUser(null);
        setStatus('unauthenticated');
      }
    } catch (error) {
      // 401 (or any failure) => treat as unauthenticated.
      if (!(error instanceof ApiClientError)) {
        // Non-API error: still fail closed.
      }
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const { user: current } = await authApi.login(email, password);
    setUser(current);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  const can = useCallback(
    (permission: Permission) => Boolean(user?.permissions.includes(permission)),
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout, can, refresh }),
    [status, user, login, logout, can, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
