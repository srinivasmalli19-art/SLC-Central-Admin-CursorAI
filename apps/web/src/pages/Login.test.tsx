import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthOptions } from '@slc/shared';

import { AuthProvider } from '../auth/AuthContext';
import { Login } from './Login';

function mockApi(options: AuthOptions) {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/auth/me')) {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, data: { user: null } }) });
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
});
