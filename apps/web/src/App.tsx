import { Route, Routes } from 'react-router-dom';
import { NAV_MODULES } from '@slc/shared';

import { AppLayout } from './components/AppLayout';
import { ComingSoon } from './components/ComingSoon';
import { Dashboard } from './pages/Dashboard';
import { NotFound } from './pages/NotFound';

/**
 * Application routing.
 *
 * The dashboard is the only implemented module in Phase 1. Every other
 * navigation module renders a clearly-labelled "coming in a later phase"
 * placeholder, derived from the shared navigation definition so routes and
 * navigation never drift apart.
 */
export function App() {
  const placeholderModules = NAV_MODULES.filter((module) => !module.implemented);

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        {placeholderModules.map((module) => (
          <Route
            key={module.id}
            path={module.path.replace(/^\//, '')}
            element={<ComingSoon title={module.label} />}
          />
        ))}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
