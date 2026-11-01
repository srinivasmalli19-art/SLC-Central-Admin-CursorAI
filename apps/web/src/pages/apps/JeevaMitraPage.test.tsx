import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@slc/shared';

import { AuthProvider } from '../../auth/AuthContext';
import { JeevaMitraPage } from './JeevaMitraPage';
import { RequireAppRole } from './RequireAppRole';
import { editFor, mergeRows } from './jeevamitra/CropGuidesPanel';
import type { JmCropDefault } from '../../lib/api';

const base: CurrentUser = {
  id: 'u1', email: 'a@slc.test', name: 'A', status: 'ACTIVE', mfaEnabled: false,
  roles: ['SUPPORT_ADMIN'], permissions: [], appRoles: {},
};

const L = (en: string, te = '', hi = '') => ({ en, te, hi });
const cotton: JmCropDefault = {
  id: 'cotton', emoji: '☁️', order: 1, basis: 'vet',
  name: L('Cotton', 'పత్తి', 'कपास'), goodFor: L('Leaves'), risk: L('Gossypol'), precautions: L('Limit grazing'),
};

const summary = { users: 3, livestockOwners: 1, landProviders: 1, both: 1, lands: 1, bookings: 0, bookingsPending: 0, alerts: 1, vets: 1, stories: 0, videos: 0, chats: 2, fieldPosts: 1, fieldPostsHidden: 0, cropGuideEdits: 0 };
const users = [
  { uid: 'f1', name: 'Rama', phone: '9876543210', profileType: 'land', village: 'Ponnur', district: 'Guntur', state: null, disabled: false },
  { uid: 'h1', name: 'Venkat', phone: '9123456780', profileType: 'livestock', village: null, district: null, state: null, disabled: true },
];
const land = { id: 'l1', kind: 'lands', title: 'Green Pasture', subtitle: 'Ponnur, Guntur', ownerId: 'f1', hidden: false, status: null, createdAt: '2026-10-01T00:00:00Z' };
const vetItem = { id: 'v1', kind: 'vets', title: 'Dr Rao', subtitle: 'Veterinary Officer', ownerId: null, hidden: false, status: null, createdAt: null };
const vet = { name: 'Dr Rao', sector: 'Government', designation: 'Veterinary Officer', services: [], experienceYears: 3, languages: ['Telugu'], village: 'Ponnur', district: 'Guntur', phone: '9000000000', rating: null, availability: 'Available today', lat: null, lng: null };

function mockApi(user: CurrentUser) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const ok = (data: unknown) => Promise.resolve({ ok: true, json: async () => ({ ok: true, data }) });
    if (url.endsWith('/auth/me')) return ok({ user });
    if (url.includes('/jeevamitra/summary')) return ok(summary);
    if (method === 'GET' && url.includes('/jeevamitra/users')) return ok({ nextCursor: null, items: users });
    if (url.includes('/account')) return ok({ uid: 'x', disabled: true });
    if (method === 'GET' && url.includes('/content/lands')) return ok({ nextCursor: null, items: [land] });
    if (method === 'GET' && url.includes('/content/vets')) return ok({ nextCursor: null, items: [vetItem] });
    if (method === 'GET' && url.includes('/vets/v1')) return ok({ vet });
    if (method === 'PUT' && url.includes('/vets/v1')) return ok({ id: 'v1' });
    if (url.includes('/visibility')) return ok({ id: 'l1', hidden: true });
    if (method === 'DELETE') return ok({ id: 'l1', deleted: true, filesDeleted: 0 });
    if (url.includes('/crop-guides')) return ok({ defaults: [cotton], defaultSettings: {}, edits: [], settings: null });
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
const tab = async (name: string) => fireEvent.click(await screen.findByRole('tab', { name }));

describe('JeevaMitra page', () => {
  afterEach(() => vi.restoreAllMocks());

  it('explains how to get access when the admin has no JeevaMitra role', async () => {
    mockApi(base);
    renderPage();
    expect(await screen.findByText('No access to JeevaMitra')).toBeTruthy();
  });

  it('viewer sees users and content but no action buttons', async () => {
    mockApi({ ...base, appRoles: { 'jeevamitra-admin': ['viewer'] } });
    renderPage();
    expect(await screen.findByText('Rama')).toBeTruthy();
    expect(screen.getByText('Switched off')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /account/ })).toBeNull();
    await tab('Lands');
    expect(await screen.findByText('Green Pasture')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  });

  it('manager pauses a land but cannot delete it (user post); can edit a vet', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const calls = mockApi({ ...base, appRoles: { 'jeevamitra-admin': ['manager'] } });
    renderPage();
    await tab('Lands');
    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/content/lands/l1/visibility'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/visibility'))!.body).toEqual({ hidden: true });
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();

    await tab('Vets');
    await screen.findByText('Dr Rao');
    const editBtn = await screen.findByRole('button', { name: 'Edit' });
    fireEvent.click(editBtn);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/vets/v1'))).toBe(true));
    const form = await screen.findByRole('form', { name: 'Edit Dr Rao' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Dr Rao K' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save vet' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/vets/v1'))).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ name: 'Dr Rao K', phone: '9000000000' });
  });

  it('super_admin enables a switched-off account and deletes a land after confirming', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const calls = mockApi({ ...base, appRoles: { 'jeevamitra-admin': ['super_admin'] } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Enable account' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/users/h1/account'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/users/h1/account'))!.body).toEqual({ disabled: false });
    await tab('Lands');
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/content/lands/l1'))).toBe(true));
  });

  it('crop cards tab lists the built-in cards with Telugu and Hindi names', async () => {
    mockApi({ ...base, appRoles: { 'jeevamitra-admin': ['manager'] } });
    renderPage();
    await tab('Crop safety cards');
    expect(await screen.findByText(/పత్తి/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ Add crop' })).toBeTruthy();
  });
});

describe('crop card edits', () => {
  it('stores only text that differs from the built-in card', () => {
    const [row] = mergeRows([cotton], []);
    row!.texts.risk.te = 'కొత్త ప్రమాదం';
    row!.texts.name.en = 'Cotton';
    row!.reviewedBy = 'Dr K';
    expect(editFor(row!, cotton)).toEqual({ hidden: false, order: 1, reviewedBy: 'Dr K', risk: { te: 'కొత్త ప్రమాదం' } });
  });

  it('applies saved edits over the built-in card and lists admin-added crops', () => {
    const rows = mergeRows([cotton], [{ id: 'cotton', hidden: true, name: { te: 'ప్రత్తి' } }, { id: 'ragi', name: { en: 'Ragi' }, order: 0 }]);
    expect(rows.map((r) => r.id)).toEqual(['ragi', 'cotton']);
    expect(rows[1]).toMatchObject({ hidden: true, edited: true, isDefault: true });
    expect(rows[1]!.texts.name).toEqual({ en: 'Cotton', te: 'ప్రత్తి', hi: 'कपास' });
    expect(rows[0]).toMatchObject({ isDefault: false, emoji: '🌱' });
  });
});
