import { useCallback, useEffect, useState } from 'react';
import type { ApplicationStats, HealthResponse } from '@slc/shared';

import { applicationsApi, fetchHealth } from '../lib/api';
import { ErrorState, LoadingState } from '../components/states';
import { StatusBadge } from '../components/StatusBadge';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; health: HealthResponse };

type StatsState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; stats: ApplicationStats };

const serviceTone = { ok: 'ok', degraded: 'warn', down: 'down' } as const;
const depTone = { connected: 'ok', disconnected: 'warn', unknown: 'muted' } as const;

export function Dashboard() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [stats, setStats] = useState<StatsState>({ kind: 'loading' });

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

  const loadStats = useCallback(() => {
    let cancelled = false;
    setStats({ kind: 'loading' });
    applicationsApi
      .stats()
      .then(({ stats: s }) => {
        if (!cancelled) setStats({ kind: 'ready', stats: s });
      })
      .catch(() => {
        if (!cancelled) setStats({ kind: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);
  useEffect(() => loadStats(), [loadStats]);

  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">Dashboard</h1>
        <span className="badge badge--muted">Registry</span>
      </header>

      <div className="card">
        <div className="card__header">
          <h2 className="card__title">Application registry</h2>
        </div>

        {stats.kind === 'loading' && <LoadingState label="Loading registry statistics…" />}

        {stats.kind === 'error' && (
          <p className="muted">
            <strong>DATA NOT CONNECTED</strong> — registry statistics are unavailable.
          </p>
        )}

        {stats.kind === 'ready' && (
          <dl className="stat-grid">
            <div className="stat">
              <dt>Total applications</dt>
              <dd>{stats.stats.total}</dd>
            </div>
            <div className="stat">
              <dt>Production</dt>
              <dd>{stats.stats.production}</dd>
            </div>
            <div className="stat">
              <dt>Development</dt>
              <dd>{stats.stats.development}</dd>
            </div>
            <div className="stat">
              <dt>Registry-only</dt>
              <dd>{stats.stats.registryOnly}</dd>
            </div>
            <div className="stat">
              <dt>Pending integrations</dt>
              <dd>{stats.stats.pendingIntegrations}</dd>
            </div>
          </dl>
        )}
      </div>

      <div className="card">
        <div className="card__header">
          <h2 className="card__title">API connectivity</h2>
        </div>

        {state.kind === 'loading' && <LoadingState label="Checking API health…" />}

        {state.kind === 'error' && <ErrorState message={state.message} onRetry={() => load()} />}

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
        <p className="muted">
          Health monitoring and per-application status arrive in a later phase. Registry counts
          above are derived from the central database; when unavailable the dashboard shows
          <strong> DATA NOT CONNECTED</strong> rather than fabricated numbers.
        </p>
      </div>
    </section>
  );
}
