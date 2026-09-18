import { NavLink } from 'react-router-dom';
import { NAV_MODULES } from '@slc/shared';

import { useAuth } from '../auth/AuthContext';

interface SidebarProps {
  open: boolean;
  onNavigate: () => void;
}

/**
 * Primary navigation. Modules the admin lacks permission for are hidden as a
 * UX affordance only — the backend independently enforces authorization.
 * Unimplemented modules are visually flagged.
 */
export function Sidebar({ open, onNavigate }: SidebarProps) {
  const { can } = useAuth();

  const visibleModules = NAV_MODULES.filter(
    (module) => !module.permission || can(module.permission),
  );

  return (
    <aside className={`sidebar ${open ? 'sidebar--open' : ''}`} aria-label="Primary">
      <div className="sidebar__brand">
        <span className="sidebar__logo" aria-hidden="true">
          SLC
        </span>
        <span className="sidebar__brand-text">Central Admin</span>
      </div>
      <nav className="sidebar__nav">
        <ul>
          {visibleModules.map((module) => (
            <li key={module.id}>
              <NavLink
                to={module.path}
                end={module.path === '/'}
                className={({ isActive }) =>
                  `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`
                }
                onClick={onNavigate}
              >
                <span>{module.label}</span>
                {!module.implemented && (
                  <span className="badge badge--muted" title="Coming in a later phase">
                    soon
                  </span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="sidebar__footer">Phase 2 · Auth &amp; RBAC</div>
    </aside>
  );
}
