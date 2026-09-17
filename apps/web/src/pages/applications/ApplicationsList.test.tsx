import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Application, CurrentUser } from '@slc/shared';

import { App } from '../../App';
import { AuthProvider } from '../../auth/AuthContext';

function makeApp(slug: string, name: string, over: Partial<Application> = {}): Application {
  return {
    id: `id-${slug}`,
    slug,
    name,
    description: null,
    platform: 'Web',
    frontendTechnology: null,
    backendTechnology: 'Node.js',
    databaseTechnology: 'PostgreSQL',
    authenticationTechnology: null,
    repositoryUrl: null,
    productionUrl: null,
    stagingUrl: null,
    environment: 'UNKNOWN',
    integrationType: 'API',
    adapterType: null,
    integrationStatus: 'PLANNED',
    status: 'UNKNOWN',
    version: null,
    healthCheckEnabled: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function mockFetch(user: CurrentUser) {
  const items = [makeApp('slc-vet', 'SLC Vet'), makeApp('pasumithra', 'Pasumithra')];
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/auth/me')) {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, data: { user } }) });
    }
    if (url.includes('/applications')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ok: true,
          data: { items, page: 1, pageSize: 10, total: 2, totalPages: 1 },
        }),
      });
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      json: async () => ({ ok: false, error: { code: 'NOT_FOUND', message: 'x' } }),
    });
  }) as unknown as typeof fetch;
}

const appAdmin: CurrentUser = {
  id: 'u1',
  email: 'appadmin@slc.test',
  name: 'App Admin',
  status: 'ACTIVE',
  mfaEnabled: false,
  roles: ['APP_ADMIN'],
  permissions: ['applications.view', 'applications.manage'],
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('Applications registry (web)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists applications for a user with applications.view', async () => {
    mockFetch(appAdmin);
    renderAt('/applications');
    expect(await screen.findByRole('heading', { name: 'Applications' })).toBeInTheDocument();
    expect(await screen.findByText('SLC Vet')).toBeInTheDocument();
    expect(screen.getByText('Pasumithra')).toBeInTheDocument();
    // manage permission -> create affordance visible
    expect(screen.getByRole('link', { name: 'New application' })).toBeInTheDocument();
  });

  it('shows Forbidden for a user lacking applications.view', async () => {
    mockFetch({ ...appAdmin, roles: ['REPORT_VIEWER'], permissions: ['reports.view'] });
    renderAt('/applications');
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
  });
});
