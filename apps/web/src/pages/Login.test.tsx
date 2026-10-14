import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthOptions } from '@slc/shared';

import { AuthProvider } from '../auth/AuthContext';
import { Login } from './Login';

function mockApi(options: AuthOptions, onLogin?: (body: Record<string, string>) => { status: number; body: unknown }) {
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/auth/me')) {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, data: { user: null } }) });
    }
    if (url.endsWith('/auth/login') && onLogin) {
      const result = onLogin(JSON.parse(String(init?.body)));
      return Promise.resolve({ ok: result.status < 400, status: result.status, json: async () => result.body });
    }
    if (url.endsWith('/auth/config')) {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, data: options }) });
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      json: async () => ({ ok: false, error: { code: 'NOT_FOUND', message: 'nope' } }),
    });
  }) as unknown as typeof fetch;
}

function renderLogin(path = '/login') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Login />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('Login page', () => {
  afterEach(() => vi.restoreAllMocks());

  it('offers only central SSO when password login is disabled', async () => {
    mockApi({ passwordLoginEnabled: false, ssoEnabled: true, ssoProviderName: 'SLC Account' });
    renderLogin();

    const button = await screen.findByRole('link', { name: 'Sign in with SLC Account' });
    expect(button.getAttribute('href')).toBe('/api/v1/auth/oidc/login?returnTo=%2F');
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('offers both methods during the migration period', async () => {
    mockApi({ passwordLoginEnabled: true, ssoEnabled: true, ssoProviderName: 'SLC Account' });
    renderLogin();

    expect(await screen.findByRole('link', { name: 'Sign in with SLC Account' })).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('explains an SSO rejection returned by the API', async () => {
    mockApi({ passwordLoginEnabled: false, ssoEnabled: true, ssoProviderName: 'SLC Account' });
    renderLogin('/login?error=sso_no_access');

    expect((await screen.findByRole('alert')).textContent).toMatch(/does not have access to Central Admin/);
  });

  it('asks break-glass accounts for their authenticator code, then sends it', async () => {
    const bodies: Record<string, string>[] = [];
    mockApi({ passwordLoginEnabled: true, ssoEnabled: true, ssoProviderName: 'SLC Account' }, (body) => {
      bodies.push(body);
      return body.otp
        ? { status: 401, body: { ok: false, error: { code: 'INVALID_CODE', message: 'bad' } } }
        : { status: 401, body: { ok: false, error: { code: 'MFA_REQUIRED', message: 'code' } } };
    });
    renderLogin();
    expect(await screen.findByText('backup sign-in, for break-glass accounts only')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ops@slc.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const code = await screen.findByLabelText('Authenticator code');
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ email: 'ops@slc.test', password: 'long-password-1', otp: '123456' });
    expect((await screen.findByRole('alert')).textContent).toMatch(/not valid/);
  });
});
