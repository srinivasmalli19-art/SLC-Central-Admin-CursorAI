import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

function mockHealthFetch() {
  const payload = {
    ok: true,
    data: {
      status: 'degraded',
      application: 'SLC Central Admin',
      version: 'v1',
      environment: 'test',
      timestamp: new Date().toISOString(),
      uptimeSeconds: 1,
      dependencies: { database: 'disconnected' },
    },
  };
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => payload,
  }) as unknown as typeof fetch;
}

describe('App shell', () => {
  beforeEach(() => mockHealthFetch());
  afterEach(() => vi.restoreAllMocks());

  it('renders the SLC Central Admin shell with the dashboard', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText('Central Admin')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();

    // Health widget resolves and renders the reported status.
    await waitFor(() => expect(screen.getByText('DEGRADED')).toBeInTheDocument());
  });

  it('renders a "coming in a later phase" placeholder for unimplemented modules', () => {
    render(
      <MemoryRouter initialEntries={['/applications']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Applications' })).toBeInTheDocument();
    expect(screen.getByText('Coming in a later phase')).toBeInTheDocument();
  });
});
