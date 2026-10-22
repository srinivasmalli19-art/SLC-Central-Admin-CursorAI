import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@slc/shared';

import { AuthProvider } from '../../auth/AuthContext';
import { JeevaMitraPage } from './JeevaMitraPage';
import { RequireAppRole } from './RequireAppRole';

const base: CurrentUser = {
  id: 'u1', email: 'a@slc.test', name: 'A', status: 'ACTIVE', mfaEnabled: false,
  roles: ['SUPPORT_ADMIN'], permissions: [], appRoles: {},
};

function mockApi(user: CurrentUser) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const ok = (data: unknown) => Promise.resolve({ ok: true, json: async () => ({ ok: true, data }) });
    if (url.endsWith('/auth/me')) return ok({ user });
    if (url.includes('/jeevamitra/summary')) return ok({ users: 2, farmers: 1, shepherds: 0, vets: 1, vetsAwaitingVerification: 1, farms: 0, bookings: 0, activeDiseaseAlerts: 0 });
    if (url.includes('/jeevamitra/users/v1/verification')) return ok({ user: {}, vetProfilesUpdated: 1 });
    if (url.includes('/jeevamitra/users')) {
      return ok({ nextCursor: null, items: [{ uid: 'v1', name: 'Dr Rao', phone: '', role: 'vet', village: null, district: 'Guntur', isVerified: false, isProfileComplete: true }] });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'NOT_FOUND', message: 'x' } }) });
  }) as unknown as typeof fetch;
  return calls;
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <AuthProvider>
        <RequireAppRole clientId="jeevamitra-admin" appName="JeevaMitra">
          <JeevaMitraPage />
        </RequireAppRole>
      </AuthProvider>
    </MemoryRouter>,
  );

describe('JeevaMitra page', () => {
  afterEach(() => vi.restoreAllMocks());

  it('explains how to get access when the admin has no JeevaMitra role', async () => {
    mockApi(base);
    renderPage();
    expect(await screen.findByText('No access to JeevaMitra')).toBeTruthy();
  });

  it('lets an app admin verify a vet; viewers see no buttons', async () => {
    const calls = mockApi({ ...base, appRoles: { 'jeevamitra-admin': ['manager'] } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/users/v1/verification'))).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ verified: true });
    expect(screen.queryByRole('button', { name: 'Disable account' })).toBeNull();
  });
});
