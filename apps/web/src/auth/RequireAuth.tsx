import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { LoadingState } from '../components/states';
import { useAuth } from './AuthContext';

/**
 * Guards protected routes. While the session is being established, shows an
 * initialization state. Unauthenticated users are redirected to /login.
 */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'initializing') {
    return (
      <div className="auth-init">
        <LoadingState label="Checking your session…" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
