import type { ReactNode } from 'react';

import { useAuth } from '../../auth/AuthContext';

/** UX guard for app pages; the API enforces the same SLC app role on every call. */
export function RequireAppRole({ clientId, appName, children }: { clientId: string; appName: string; children: ReactNode }) {
  const { hasAppRole } = useAuth();
  if (!hasAppRole(clientId, ['viewer', 'admin', 'super_admin'])) {
    return (
      <section className="page">
        <div className="card">
          <h1 className="page__title">No access to {appName}</h1>
          <p className="muted">
            Ask a Super Admin to give you a {appName} role in Admin access, then sign out and sign in again.
          </p>
        </div>
      </section>
    );
  }
  return <>{children}</>;
}
