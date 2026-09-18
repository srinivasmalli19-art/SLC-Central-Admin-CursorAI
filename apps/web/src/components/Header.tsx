import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';

interface HeaderProps {
  onToggleSidebar: () => void;
}

export function Header({ onToggleSidebar }: HeaderProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  async function onLogout() {
    setLoggingOut(true);
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <header className="header">
      <button
        type="button"
        className="header__menu-btn"
        aria-label="Toggle navigation"
        onClick={onToggleSidebar}
      >
        <span aria-hidden="true">☰</span>
      </button>
      <div className="header__title">SLC Central Admin</div>
      <div className="header__spacer" />
      {user && (
        <div className="header__user">
          <span className="header__user-email" title={user.roles.join(', ')}>
            {user.email}
          </span>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onLogout}
            disabled={loggingOut}
          >
            {loggingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </header>
  );
}
