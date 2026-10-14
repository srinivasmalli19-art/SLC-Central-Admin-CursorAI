import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser, IdentityUser } from '@slc/shared';

import { AuthProvider } from '../../auth/AuthContext';
import { AdminAccess } from './AdminAccess';

const superAdmin: CurrentUser = {
  id: 'u1',
  email: 'boss@slc.test',
  name: 'Boss',
  status: 'ACTIVE',
  mfaEnabled: false,
  roles: ['SUPER_ADMIN'],
  permissions: ['admin_users.view', 'admin_users.manage', 'system.manage'],
};

const ravi: IdentityUser = {
  id: 'kc-1',
  email: 'ravi@slc.test',
  firstName: 'Ravi',
  lastName: 'Kumar',
  enabled: true,
  emailVerified: true,
  mfaEnrolled: false,
  pendingActions: [],
  createdAt: null,
  appRoles: { 'pasumithra-admin': ['moderator'] },
  groups: [],
};

function mockApi(currentUser: CurrentUser) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const ok = (data: unknown) => Promise.resolve({ ok: true, json: async () => ({ ok: true, data }) });
    if (url.endsWith('/auth/me')) return ok({ user: currentUser });
    if (url.endsWith('/identity/apps')) {
      return ok({
        apps: [
          { clientId: 'central-admin', name: 'SLC Central Admin', roles: ['SUPER_ADMIN', 'SUPPORT_ADMIN'] },
          { clientId: 'pasumithra-admin', name: 'Pasumithra', roles: ['moderator', 'viewer'] },
        ],
      });
    }
    if (url.includes('/identity/users?')) return ok({ users: [ravi] });
    if (url.endsWith('/identity/users/kc-1/roles')) {
      return ok({ user: { ...ravi, appRoles: { 'pasumithra-admin': ['moderator', 'viewer'] } } });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'NOT_FOUND', message: 'nope' } }) });
  }) as unknown as typeof fetch;
  return calls;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <AdminAccess />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('Admin access page', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists admins with their access per app and MFA status', async () => {
    mockApi(superAdmin);
    renderPage();
    expect(await screen.findByText('Ravi Kumar')).toBeTruthy();
    expect(screen.getByText('Pasumithra')).toBeTruthy();
    expect(screen.getByText('moderator')).toBeTruthy();
    expect(screen.getByText('MFA not set up')).toBeTruthy();
  });

  it('saves edited access for every app', async () => {
    const calls = mockApi(superAdmin);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit access' }));
    const viewer = screen.getAllByRole('checkbox', { name: 'viewer' })[0]!;
    fireEvent.click(viewer);
    fireEvent.click(screen.getByRole('button', { name: 'Save access' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Access updated/));
    const save = calls.find((c) => c.method === 'PUT')!;
    expect(save.body).toEqual({
      appRoles: { 'central-admin': [], 'pasumithra-admin': ['moderator', 'viewer'] },
    });
  });

  it('hides management controls from view-only admins', async () => {
    mockApi({ ...superAdmin, roles: ['REPORT_VIEWER'], permissions: ['admin_users.view'] });
    renderPage();
    expect(await screen.findByText('Ravi Kumar')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Invite admin' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disable' })).toBeNull();
  });
});
