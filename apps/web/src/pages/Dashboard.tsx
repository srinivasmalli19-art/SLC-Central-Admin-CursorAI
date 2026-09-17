import { useCallback, useEffect, useState } from 'react';
import type { HealthResponse } from '@slc/shared';

import { fetchHealth } from '../lib/api';
import { ErrorState, LoadingState } from '../components/states';
import { StatusBadge } from '../components/StatusBadge';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; health: HealthResponse };

const serviceTone = { ok: 'ok', degraded: 'warn', down: 'down' } as const;
const depTone = { connected: 'ok', disconnected: 'warn', unknown: 'muted' } as const;

export function Dashboard() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const load = useCallback(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    fetchHealth()
      .then((health) => {
        if (!cancelled) setState({ kind: 'ready', health });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Failed to load health.';
        setState({ kind: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">Dashboard</h1>
        <span className="badge badge--muted">Phase 1 · Foundation</span>
      </header>

      <div className="card">
        <div className="card__header">
          <h2 className="card__title">API connectivity</h2>
        </div>

        {state.kind === 'loading' && <LoadingState label="Checking API health…" />}

        {state.kind === 'error' && (
          <ErrorState message={state.message} onRetry={() => load()} />
        )}

        {state.kind === 'ready' && (
          <dl className="stat-grid">
            <div className="stat">
              <dt>Service status</dt>
              <dd>
                <StatusBadge tone={serviceTone[state.health.status]}>
                  {state.health.status.toUpperCase()}
                </StatusBadge>
              </dd>
            </div>
            <div className="stat">
              <dt>Application</dt>
              <dd>{state.health.application}</dd>
            </div>
            <div className="stat">
              <dt>Environment</dt>
              <dd>{state.health.environment}</dd>
            </div>
            <div className="stat">
              <dt>API version</dt>
              <dd>{state.health.version}</dd>
            </div>
            <div className="stat">
              <dt>Database</dt>
              <dd>
                <StatusBadge tone={depTone[state.health.dependencies.database]}>
                  {state.health.dependencies.database}
                </StatusBadge>
              </dd>
            </div>
            <div className="stat">
              <dt>Uptime</dt>
              <dd>{state.health.uptimeSeconds}s</dd>
            </div>
          </dl>
        )}
      </div>

      <div className="card card--placeholder">
        <p>
          Operational widgets (application counts, health, recent administrative activity,
          alerts) arrive in later phases.
        </p>
        <p className="muted">
          Placeholders never show fabricated numbers. When an integration is not connected,
          the platform will explicitly show <strong>DATA NOT CONNECTED</strong>.
        </p>
      </div>
    </section>
  );
}
