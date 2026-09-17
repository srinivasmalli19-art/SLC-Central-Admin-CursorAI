import { Route, Routes } from 'react-router-dom';
import { NAV_MODULES } from '@slc/shared';

import { AppLayout } from './components/AppLayout';
import { ComingSoon } from './components/ComingSoon';
import { RequireAuth } from './auth/RequireAuth';
import { RequirePermission } from './auth/RequirePermission';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { NotFound } from './pages/NotFound';
import { ApplicationsList } from './pages/applications/ApplicationsList';
import { ApplicationDetail } from './pages/applications/ApplicationDetail';
import { ApplicationForm } from './pages/applications/ApplicationForm';

/**
 * Application routing.
 *
 * `/login` is public. Everything else is behind `RequireAuth` and the
 * authenticated shell. Placeholder modules additionally require their module
 * permission via `RequirePermission` (UX); the backend enforces permissions
 * independently on every API call.
 */
export function App() {
  const placeholderModules = NAV_MODULES.filter((module) => !module.implemented);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<Dashboard />} />

          <Route
            path="applications"
            element={
              <RequirePermission permission="applications.view">
                <ApplicationsList />
              </RequirePermission>
            }
          />
          <Route
            path="applications/new"
            element={
              <RequirePermission permission="applications.manage">
                <ApplicationForm mode="create" />
              </RequirePermission>
            }
          />
          <Route
            path="applications/:id"
            element={
              <RequirePermission permission="applications.view">
                <ApplicationDetail />
              </RequirePermission>
            }
          />
          <Route
            path="applications/:id/edit"
            element={
              <RequirePermission permission="applications.manage">
                <ApplicationForm mode="edit" />
              </RequirePermission>
            }
          />

          {placeholderModules.map((module) => {
            const element = <ComingSoon title={module.label} />;
            return (
              <Route
                key={module.id}
                path={module.path.replace(/^\//, '')}
                element={
                  module.permission ? (
                    <RequirePermission permission={module.permission}>{element}</RequirePermission>
                  ) : (
                    element
                  )
                }
              />
            );
          })}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
