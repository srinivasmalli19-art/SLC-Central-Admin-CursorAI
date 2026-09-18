import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  APP_STATUSES,
  INTEGRATION_STATUSES,
  INTEGRATION_TYPES,
  type Application,
  type ApplicationListQuery,
  type PaginatedResult,
} from '@slc/shared';

import { applicationsApi } from '../../lib/api';
import { show } from '../../lib/display';
import { useAuth } from '../../auth/AuthContext';
import { ErrorState, LoadingState } from '../../components/states';
import { StatusBadge } from '../../components/StatusBadge';

const PAGE_SIZE = 10;

const statusTone = (s: string) =>
  s === 'PRODUCTION' ? 'ok' : s === 'DEPRECATED' ? 'down' : s === 'UNKNOWN' ? 'muted' : 'warn';

export function ApplicationsList() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const [query, setQuery] = useState<ApplicationListQuery>({
    page: 1,
    pageSize: PAGE_SIZE,
    sortBy: 'name',
    sortDir: 'asc',
  });
  const [searchText, setSearchText] = useState('');
  const [data, setData] = useState<PaginatedResult<Application> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((q: ApplicationListQuery) => {
    setLoading(true);
    setError(null);
    applicationsApi
      .list(q)
      .then((result) => setData(result))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load applications.'),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(query), [load, query]);

  const patchQuery = (patch: Partial<ApplicationListQuery>) =>
    setQuery((prev) => ({ ...prev, page: 1, ...patch }));

  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">Applications</h1>
        <span className="badge badge--muted">Registry</span>
        <div className="page__header-actions">
          {can('applications.manage') && (
            <Link className="btn" to="/applications/new">
              New application
            </Link>
          )}
        </div>
      </header>

      <div className="card">
        <div className="toolbar">
          <form
            className="toolbar__search"
            onSubmit={(e) => {
              e.preventDefault();
              patchQuery({ q: searchText || undefined });
            }}
          >
            <input
              className="field__input"
              type="search"
              placeholder="Search name, slug, description…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              aria-label="Search applications"
            />
          </form>

          <select
            className="field__input toolbar__filter"
            aria-label="Filter by status"
            value={query.status ?? ''}
            onChange={(e) => patchQuery({ status: (e.target.value || undefined) as never })}
          >
            <option value="">All statuses</option>
            {APP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            className="field__input toolbar__filter"
            aria-label="Filter by integration type"
            value={query.integrationType ?? ''}
            onChange={(e) => patchQuery({ integrationType: (e.target.value || undefined) as never })}
          >
            <option value="">All integration types</option>
            {INTEGRATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <select
            className="field__input toolbar__filter"
            aria-label="Filter by integration status"
            value={query.integrationStatus ?? ''}
            onChange={(e) =>
              patchQuery({ integrationStatus: (e.target.value || undefined) as never })
            }
          >
            <option value="">All integration statuses</option>
            {INTEGRATION_STATUSES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <select
            className="field__input toolbar__filter"
            aria-label="Sort by"
            value={`${query.sortBy}:${query.sortDir}`}
            onChange={(e) => {
              const [sortBy, sortDir] = e.target.value.split(':') as [never, never];
              patchQuery({ sortBy, sortDir });
            }}
          >
            <option value="name:asc">Name (A–Z)</option>
            <option value="name:desc">Name (Z–A)</option>
            <option value="status:asc">Status (A–Z)</option>
            <option value="createdAt:desc">Newest</option>
          </select>
        </div>

        {loading && <LoadingState label="Loading applications…" />}
        {error && !loading && <ErrorState message={error} onRetry={() => load(query)} />}

        {data && !loading && !error && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Platform</th>
                    <th>Backend</th>
                    <th>Database</th>
                    <th>Status</th>
                    <th>Integration</th>
                    <th>Integration status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((app) => (
                    <tr
                      key={app.id}
                      className="table__row--clickable"
                      onClick={() => navigate(`/applications/${app.id}`)}
                    >
                      <td>
                        <strong>{app.name}</strong>
                        <div className="muted table__sub">{app.slug}</div>
                      </td>
                      <td>{show(app.platform)}</td>
                      <td>{show(app.backendTechnology)}</td>
                      <td>{show(app.databaseTechnology)}</td>
                      <td>
                        <StatusBadge tone={statusTone(app.status)}>{app.status}</StatusBadge>
                      </td>
                      <td>{app.integrationType}</td>
                      <td>{app.integrationStatus}</td>
                    </tr>
                  ))}
                  {data.items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted">
                        No applications match your filters.
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
                Page {data.page} of {data.totalPages} · {data.total} total
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
