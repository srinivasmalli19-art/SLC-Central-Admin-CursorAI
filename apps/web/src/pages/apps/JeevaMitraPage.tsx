import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { ErrorState, LoadingState } from '../../components/states';
import { KpiRow } from '../../components/KpiRow';
import { StatusBadge } from '../../components/StatusBadge';
import { ApiClientError, jeevamitraApi, type JmAlert, type JmSummary, type JmUser } from '../../lib/api';

const CLIENT = 'jeevamitra-admin';
type Tab = 'vets' | 'users' | 'alerts';

function message(err: unknown): string {
  return err instanceof ApiClientError || err instanceof Error ? err.message : 'Something went wrong.';
}

/** JeevaMitra administration: verify vets, moderate disease alerts, manage accounts. */
export function JeevaMitraPage() {
  const { hasAppRole } = useAuth();
  const canManage = hasAppRole(CLIENT, ['admin', 'super_admin']);
  const canAccounts = hasAppRole(CLIENT, ['super_admin']);

  const [tab, setTab] = useState<Tab>('vets');
  const [summary, setSummary] = useState<JmSummary | null>(null);
  const [users, setUsers] = useState<JmUser[] | null>(null);
  const [alerts, setAlerts] = useState<JmAlert[] | null>(null);
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const list =
      tab === 'alerts'
        ? jeevamitraApi.alerts(false).then((r) => setAlerts(r.alerts))
        : jeevamitraApi
            .users(tab === 'vets' ? { role: 'vet' } : { role: roleFilter || undefined })
            .then((r) => setUsers(r.items));
    Promise.all([jeevamitraApi.summary().then(setSummary), list])
      .catch((err: unknown) => setError(message(err)))
      .finally(() => setLoading(false));
  }, [tab, roleFilter]);

  useEffect(() => load(), [load]);

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setNotice(null);
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  const vets = [...(users ?? [])].sort((a, b) => Number(a.isVerified) - Number(b.isVerified));

  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">JeevaMitra</h1>
        <span className="badge badge--muted">Livestock & fodder · Firebase</span>
      </header>

      {summary && (
        <KpiRow
          items={[
            { label: 'Users', value: summary.users },
            { label: 'Vets awaiting verification', value: summary.vetsAwaitingVerification, tone: 'warn' },
            { label: 'Farms', value: summary.farms },
            { label: 'Active disease alerts', value: summary.activeDiseaseAlerts, tone: 'warn' },
          ]}
        />
      )}

      {notice && <div className="notice" role="status">{notice}</div>}

      <div className="card">
        <div className="tabs" role="tablist">
          {(['vets', 'users', 'alerts'] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`tabs__tab ${tab === t ? 'tabs__tab--active' : ''}`} onClick={() => setTab(t)}>
              {t === 'vets' ? 'Vet verification' : t === 'users' ? 'Users' : 'Disease alerts'}
            </button>
          ))}
        </div>

        {tab === 'users' && (
          <div className="toolbar">
            <select className="field__input toolbar__filter" aria-label="Filter by role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="">All roles</option>
              <option value="farmer">Farmers</option>
              <option value="shepherd">Shepherds</option>
              <option value="vet">Vets</option>
            </select>
          </div>
        )}

        {loading && <LoadingState label="Loading JeevaMitra…" />}
        {error && !loading && <ErrorState message={error} onRetry={load} />}

        {!loading && !error && tab !== 'alerts' && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Name</th><th>Role</th><th>District</th><th>Status</th>{(canManage || canAccounts) && <th aria-label="Actions" />}</tr>
              </thead>
              <tbody>
                {(tab === 'vets' ? vets : users ?? []).map((u) => (
                  <tr key={u.uid}>
                    <td><strong>{u.name || '(no name)'}</strong><div className="muted table__sub">{u.phone}</div></td>
                    <td>{u.role}</td>
                    <td>{u.district ?? <span className="muted">—</span>}</td>
                    <td>
                      {u.role === 'vet' && (
                        <StatusBadge tone={u.isVerified ? 'ok' : 'warn'}>{u.isVerified ? 'Verified' : 'Not verified'}</StatusBadge>
                      )}
                    </td>
                    {(canManage || canAccounts) && (
                      <td>
                        <div className="row-actions">
                          {canManage && u.role === 'vet' && (
                            <button type="button" className={u.isVerified ? 'btn btn--ghost' : 'btn'} disabled={busy === u.uid}
                              onClick={() => void act(u.uid, async () => {
                                await jeevamitraApi.setVerified(u.uid, !u.isVerified);
                                setNotice(`${u.name || 'Vet'} is now ${u.isVerified ? 'unverified' : 'verified'}.`);
                              })}>
                              {u.isVerified ? 'Remove verification' : 'Verify'}
                            </button>
                          )}
                          {canAccounts && (
                            <button type="button" className="btn btn--danger" disabled={busy === u.uid}
                              onClick={() => {
                                if (!window.confirm(`Disable ${u.name || 'this user'}'s JeevaMitra account and sign them out?`)) return;
                                void act(u.uid, async () => {
                                  await jeevamitraApi.setDisabled(u.uid, true);
                                  setNotice(`${u.name || 'User'} is disabled.`);
                                });
                              }}>
                              Disable account
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {(users ?? []).length === 0 && (
                  <tr><td colSpan={5} className="muted">No users found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && tab === 'alerts' && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Alert</th><th>Severity</th><th>Where</th><th>Source</th><th>Status</th>{canManage && <th aria-label="Actions" />}</tr>
              </thead>
              <tbody>
                {(alerts ?? []).map((a) => (
                  <tr key={a.id}>
                    <td><strong>{a.title || a.disease}</strong><div className="muted table__sub">{a.disease}</div></td>
                    <td>{a.severity}</td>
                    <td>{[a.village, a.district].filter(Boolean).join(', ')}</td>
                    <td>{a.sourceAuthority || <span className="muted">community</span>}</td>
                    <td><StatusBadge tone={a.isActive ? 'ok' : 'muted'}>{a.isActive ? 'Active' : 'Inactive'}</StatusBadge></td>
                    {canManage && (
                      <td>
                        <div className="row-actions">
                          <button type="button" className="btn btn--ghost" disabled={busy === a.id}
                            onClick={() => void act(a.id, async () => {
                              await jeevamitraApi.setAlertActive(a.id, !a.isActive);
                              setNotice(`Alert ${a.isActive ? 'deactivated' : 'reactivated'}.`);
                            })}>
                            {a.isActive ? 'Deactivate' : 'Reactivate'}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {(alerts ?? []).length === 0 && <tr><td colSpan={6} className="muted">No disease alerts.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
