import type { ReactNode } from 'react';
import type { Permission } from '@slc/shared';

import { Forbidden } from '../pages/Forbidden';
import { useAuth } from './AuthContext';

/**
 * Renders children only if the current admin holds the given permission,
 * otherwise shows the Forbidden page. This is a UX affordance — the backend
 * independently enforces the same permission on every API call.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { can } = useAuth();
  if (!can(permission)) {
    return <Forbidden requiredPermission={permission} />;
  }
  return <>{children}</>;
}
