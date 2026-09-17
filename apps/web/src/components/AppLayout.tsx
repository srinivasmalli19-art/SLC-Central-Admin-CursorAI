import { useState } from 'react';
import { Outlet } from 'react-router-dom';

import { Header } from './Header';
import { Sidebar } from './Sidebar';

/** Responsive application shell: header + collapsible sidebar + content area. */
export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="layout">
      <Sidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
      {sidebarOpen && (
        <button
          type="button"
          className="layout__scrim"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <div className="layout__main">
        <Header onToggleSidebar={() => setSidebarOpen((open) => !open)} />
        <main className="layout__content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
