import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@slc/shared';

import { AuthProvider } from '../../auth/AuthContext';
import { PasunestamPage } from './PasunestamPage';
import { RequireAppRole } from './RequireAppRole';

const base: CurrentUser = {
  id: 'u1', email: 'a@slc.test', name: 'A', status: 'ACTIVE', mfaEnabled: false,
  roles: ['SUPPORT_ADMIN'], permissions: [], appRoles: {},
};

const summary = {
  vets: 3, staff: 1, certificatesIssued: 10, certificatesCancelled: 1, certificatesDraft: 0,
  casesAwaitingReview: 1, casesPublished: 4, templates: 2, templatesPublished: 2, schemes: 1, schemeApplications: 5,
};

function mockApi(user: CurrentUser) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const ok = (data: unknown) => Promise.resolve({ ok: true, json: async () => ({ ok: true, data }) });
    if (url.endsWith('/auth/me')) return ok({ user });
    if (url.includes('/pasunestam/summary')) return ok(summary);
    if (url.includes('/pasunestam/cases/c1/review')) return ok({ case: {} });
    if (url.includes('/pasunestam/cases')) {
      return ok({ cases: [{ id: 'c1', title: 'Bloat in a buffalo', species: 'Buffalo', body: 'History', submitterName: 'Dr Lakshmi', submittedBy: 'v1', status: 'submitted', createdAt: null, reviewedAt: null, reviewedBy: null }] });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'NOT_FOUND', message: 'x' } }) });
  }) as unknown as typeof fetch;
  return calls;
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <AuthProvider>
        <RequireAppRole clientId="pasunestam-admin" appName="Pasunestam" roles={['editor', 'manager']}>
          <PasunestamPage />
        </RequireAppRole>
      </AuthProvider>
    </MemoryRouter>,
  );

describe('Pasunestam page', () => {
  afterEach(() => vi.restoreAllMocks());

  it('explains how to get access without a Pasunestam role', async () => {
    mockApi({ ...base, appRoles: { 'jeevamitra-admin': ['super_admin'] } });
    renderPage();
    expect(await screen.findByText('No access to Pasunestam')).toBeTruthy();
  });

  it('lets an editor publish a waiting case; manager-only tabs are hidden', async () => {
    const calls = mockApi({ ...base, appRoles: { 'pasunestam-admin': ['editor'] } });
    renderPage();
    expect(await screen.findByText('Cases awaiting review')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/cases/c1/review'))).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ decision: 'published' });
    expect(screen.queryByRole('tab', { name: 'Vets' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Scheme applications' })).toBeNull();
  });

  it('shows the vet and application tabs to a manager', async () => {
    mockApi({ ...base, appRoles: { 'pasunestam-admin': ['manager'] } });
    renderPage();
    expect(await screen.findByRole('tab', { name: 'Vets' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Scheme applications' })).toBeTruthy();
  });
});
