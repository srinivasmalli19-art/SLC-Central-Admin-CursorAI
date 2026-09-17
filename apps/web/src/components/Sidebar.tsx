import { NavLink } from 'react-router-dom';
import { NAV_MODULES } from '@slc/shared';

interface SidebarProps {
  open: boolean;
  onNavigate: () => void;
}

/** Primary navigation. Unimplemented modules are visually flagged. */
export function Sidebar({ open, onNavigate }: SidebarProps) {
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
          {NAV_MODULES.map((module) => (
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
      <div className="sidebar__footer">Phase 1 · Foundation</div>
    </aside>
  );
}
