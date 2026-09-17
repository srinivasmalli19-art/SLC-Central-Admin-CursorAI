import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import type { CurrentUser } from '@slc/shared';

const health = {
  status: 'ok',
  application: 'SLC Central Admin',
  version: 'v1',
  environment: 'test',
  timestamp: new Date().toISOString(),
  uptimeSeconds: 1,
  dependencies: { database: 'connected' },
};

function mockFetch(user: CurrentUser | null) {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/auth/me')) {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, data: { user } }) });
    }
    if (url.endsWith('/health')) {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, data: health }) });
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      json: async () => ({ ok: false, error: { code: 'NOT_FOUND', message: 'nope' } }),
    });
  }) as unknown as typeof fetch;
}

const superAdmin: CurrentUser = {
  id: 'u1',
  email: 'admin@slc.test',
  name: 'Super Admin',
  status: 'ACTIVE',
  mfaEnabled: false,
  roles: ['SUPER_ADMIN'],
  permissions: ['applications.view', 'system.manage'],
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

describe('App auth shell', () => {
  afterEach(() => vi.restoreAllMocks());

  it('redirects unauthenticated users to the login page', async () => {
    mockFetch(null);
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Central Admin' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('renders the authenticated dashboard for a signed-in admin', async () => {
    mockFetch(superAdmin);
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    // Live health widget resolves.
    expect(await screen.findByText('OK')).toBeInTheDocument();
    // The admin's email is shown in the header.
    expect(screen.getByText('admin@slc.test')).toBeInTheDocument();
  });

  it('shows a Forbidden page when the admin lacks the module permission', async () => {
    mockFetch({ ...superAdmin, permissions: ['reports.view'] });
    renderAt('/settings');
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
  });
});
