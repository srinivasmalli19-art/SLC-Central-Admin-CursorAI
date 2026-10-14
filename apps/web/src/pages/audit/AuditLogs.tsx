import { useCallback, useEffect, useState } from 'react';
import type { AuditLogEntry, AuditLogQuery, PaginatedResult } from '@slc/shared';

import { ErrorState, LoadingState } from '../../components/states';
import { auditApi } from '../../lib/api';

const PAGE_SIZE = 25;

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDetail(entry: AuditLogEntry): string {
  if (!entry.metadata) return '';
  return Object.entries(entry.metadata)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join(' · ');
}

/** Every sign-in and privileged change across Central Admin, newest first. */
export function AuditLogs() {
  const [query, setQuery] = useState<AuditLogQuery>({ page: 1, pageSize: PAGE_SIZE });
  const [actorText, setActorText] = useState('');
  const [actions, setActions] = useState<string[]>([]);
  const [data, setData] = useState<PaginatedResult<AuditLogEntry> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((q: AuditLogQuery) => {
    setLoading(true);
    setError(null);
    auditApi
      .list(q)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load the audit log.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(query), [load, query]);
  useEffect(() => {
    auditApi
      .actions()
      .then((res) => setActions(res.actions))
      .catch(() => setActions([]));
  }, []);

  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">Audit log</h1>
      </header>

      <div className="card">
        <div className="toolbar">
          <form
            className="toolbar__search"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery((p) => ({ ...p, page: 1, actorEmail: actorText || undefined }));
            }}
          >
            <input
              className="field__input"
              type="search"
              placeholder="Filter by who did it (email)…"
              value={actorText}
              onChange={(e) => setActorText(e.target.value)}
              aria-label="Filter by actor email"
            />
          </form>
          <select
            className="field__input toolbar__filter"
            aria-label="Filter by action"
            value={query.action ?? ''}
            onChange={(e) => setQuery((p) => ({ ...p, page: 1, action: e.target.value || undefined }))}
          >
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        {loading && <LoadingState label="Loading audit log…" />}
        {error && !loading && <ErrorState message={error} onRetry={() => load(query)} />}

        {data && !loading && !error && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>Who</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((entry) => (
                    <tr key={entry.id}>
                      <td className="nowrap">{formatWhen(entry.createdAt)}</td>
                      <td>
                        <code>{entry.action}</code>
                      </td>
                      <td>
                        {entry.actorEmail ?? <span className="muted">system</span>}
                        {entry.ipAddress && <div className="muted table__sub">{entry.ipAddress}</div>}
                      </td>
                      <td className="table__detail">{formatDetail(entry)}</td>
                    </tr>
                  ))}
                  {data.items.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted">
                        No audit entries match.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <button
                type="button"
                className="btn btn--ghost"
                disabled={data.page <= 1}
                onClick={() => setQuery((p) => ({ ...p, page: (p.page ?? 1) - 1 }))}
              >
                Previous
              </button>
              <span className="muted">
                Page {data.page} of {data.totalPages} · {data.total} entries
              </span>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={data.page >= data.totalPages}
                onClick={() => setQuery((p) => ({ ...p, page: (p.page ?? 1) + 1 }))}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
