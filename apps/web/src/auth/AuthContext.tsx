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
  /** UX-only: whether the admin holds any of `roles` in an SLC app. */
  hasAppRole: (clientId: string, roles: readonly string[]) => boolean;
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
    let ssoLogoutUrl: string | undefined;
    try {
      ({ ssoLogoutUrl } = await authApi.logout());
    } finally {
      setUser(null);
      setStatus('unauthenticated');
    }
    if (ssoLogoutUrl) {
      // End the central SSO session too; the IdP sends the browser back to /login.
      window.location.assign(ssoLogoutUrl);
    }
  }, []);

  const can = useCallback(
    (permission: Permission) => Boolean(user?.permissions.includes(permission)),
    [user],
  );

  const hasAppRole = useCallback(
    (clientId: string, roles: readonly string[]) =>
      Boolean(user?.appRoles?.[clientId]?.some((role) => roles.includes(role))),
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout, can, hasAppRole, refresh }),
    [status, user, login, logout, can, hasAppRole, refresh],
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
