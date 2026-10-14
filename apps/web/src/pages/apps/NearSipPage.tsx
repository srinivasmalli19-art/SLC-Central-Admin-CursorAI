import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { ErrorState, LoadingState } from '../../components/states';
import { KpiRow } from '../../components/KpiRow';
import { StatusBadge } from '../../components/StatusBadge';
import { ApiClientError, nearsipApi, type NsPlaceInput, type NsRow } from '../../lib/api';

const CLIENT = 'nearsip-admin';
type Tab = 'places' | 'reviews' | 'users';

const EMPTY_PLACE: NsPlaceInput = {
  name: '',
  type: 'drink',
  address: null,
  latitude: 0,
  longitude: 0,
  rating: null,
  is_hotspot: false,
  is_verified: false,
  is_popular: false,
};

function message(err: unknown): string {
  return err instanceof ApiClientError || err instanceof Error ? err.message : 'Something went wrong.';
}
const text = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

/** NearSip administration (replaces the app's old in-app admin). */
export function NearSipPage() {
  const { hasAppRole } = useAuth();
  const canManage = hasAppRole(CLIENT, ['admin', 'super_admin']);
  const canAccounts = hasAppRole(CLIENT, ['super_admin']);

  const [tab, setTab] = useState<Tab>('places');
  const [summary, setSummary] = useState<{ places: number; reviews: number; users: number } | null>(null);
  const [rows, setRows] = useState<NsRow[]>([]);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; value: NsPlaceInput } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const list =
      tab === 'places' ? nearsipApi.places({ search: query || undefined }) : tab === 'reviews' ? nearsipApi.reviews() : nearsipApi.users();
    Promise.all([nearsipApi.summary().then(setSummary), list.then((r) => setRows(r.items))])
      .catch((err: unknown) => setError(message(err)))
      .finally(() => setLoading(false));
  }, [tab, query]);

  useEffect(() => load(), [load]);

  async function run(fn: () => Promise<string>) {
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
      load();
    } catch (err) {
      setError(message(err));
    }
  }

  async function savePlace(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    await run(async () => {
      if (editing.id) await nearsipApi.updatePlace(editing.id, editing.value);
      else await nearsipApi.createPlace(editing.value);
      setEditing(null);
      return `Place "${editing.value.name}" saved.`;
    });
    setSaving(false);
  }

  function editPlace(row: NsRow) {
    setEditing({
      id: row.id,
      value: {
        name: String(row.name ?? ''),
        type: (['drink', 'food', 'both', 'hotspot'].includes(String(row.type)) ? row.type : 'drink') as NsPlaceInput['type'],
        address: (row.address as string | null) ?? null,
        latitude: Number(row.latitude ?? 0),
        longitude: Number(row.longitude ?? 0),
        rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
        is_hotspot: row.is_hotspot === true,
        is_verified: row.is_verified === true,
        is_popular: row.is_popular === true,
      },
    });
  }

  const set = <K extends keyof NsPlaceInput>(key: K, value: NsPlaceInput[K]) =>
    setEditing((e) => (e ? { ...e, value: { ...e.value, [key]: value } } : e));

  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">NearSip</h1>
        <span className="badge badge--muted">Places · Supabase</span>
        <div className="page__header-actions">
          {canManage && tab === 'places' && (
            <button type="button" className="btn" onClick={() => setEditing({ id: null, value: EMPTY_PLACE })}>
              Add place
            </button>
          )}
        </div>
      </header>

      {summary && (
        <KpiRow
          items={[
            { label: 'Places', value: summary.places },
            { label: 'Reviews', value: summary.reviews },
            { label: 'Users', value: summary.users },
          ]}
        />
      )}

      {notice && <div className="notice" role="status">{notice}</div>}

      {editing && (
        <form className="card access-panel" onSubmit={savePlace} aria-label="Place">
          <div className="card__header"><h2 className="card__title">{editing.id ? 'Edit place' : 'Add place'}</h2></div>
          <div className="form-grid">
            <label className="field"><span className="field__label">Name</span>
              <input className="field__input" required value={editing.value.name} onChange={(e) => set('name', e.target.value)} /></label>
            <label className="field"><span className="field__label">Type</span>
              <select className="field__input" value={editing.value.type} onChange={(e) => set('type', e.target.value as NsPlaceInput['type'])}>
                <option value="drink">Drink</option><option value="food">Food</option><option value="both">Both</option><option value="hotspot">Hotspot</option>
              </select></label>
            <label className="field"><span className="field__label">Address</span>
              <input className="field__input" value={editing.value.address ?? ''} onChange={(e) => set('address', e.target.value || null)} /></label>
            <label className="field"><span className="field__label">Latitude</span>
              <input className="field__input" type="number" step="any" required value={editing.value.latitude} onChange={(e) => set('latitude', Number(e.target.value))} /></label>
            <label className="field"><span className="field__label">Longitude</span>
              <input className="field__input" type="number" step="any" required value={editing.value.longitude} onChange={(e) => set('longitude', Number(e.target.value))} /></label>
            <label className="field"><span className="field__label">Rating (0–5)</span>
              <input className="field__input" type="number" step="0.1" min="0" max="5" value={editing.value.rating ?? ''} onChange={(e) => set('rating', e.target.value === '' ? null : Number(e.target.value))} /></label>
            <label className="field field--checkbox"><input type="checkbox" checked={editing.value.is_hotspot} onChange={(e) => set('is_hotspot', e.target.checked)} /> Drink hotspot</label>
            <label className="field field--checkbox"><input type="checkbox" checked={editing.value.is_verified} onChange={(e) => set('is_verified', e.target.checked)} /> Verified business</label>
            <label className="field field--checkbox"><input type="checkbox" checked={editing.value.is_popular} onChange={(e) => set('is_popular', e.target.checked)} /> Popular</label>
            <div className="form-actions">
              <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save place'}</button>
              <button className="btn btn--ghost" type="button" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </form>
      )}

      <div className="card">
        <div className="tabs" role="tablist">
          {(['places', 'reviews', 'users'] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`tabs__tab ${tab === t ? 'tabs__tab--active' : ''}`} onClick={() => setTab(t)}>
              {t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === 'places' && (
          <div className="toolbar">
            <form className="toolbar__search" onSubmit={(e) => { e.preventDefault(); setQuery(search); }}>
              <input className="field__input" type="search" placeholder="Search places by name…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search places" />
            </form>
          </div>
        )}

        {loading && <LoadingState label="Loading NearSip…" />}
        {error && !loading && <ErrorState message={error} onRetry={load} />}

        {!loading && !error && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                {tab === 'places' && <tr><th>Name</th><th>Type</th><th>Address</th><th>Rating</th><th>Flags</th>{canManage && <th aria-label="Actions" />}</tr>}
                {tab === 'reviews' && <tr><th>Review</th><th>Place</th><th>Rating</th><th>When</th>{canManage && <th aria-label="Actions" />}</tr>}
                {tab === 'users' && <tr><th>User</th><th>Joined</th>{canAccounts && <th aria-label="Actions" />}</tr>}
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    {tab === 'places' && (
                      <>
                        <td><strong>{text(row.name)}</strong></td>
                        <td>{text(row.type)}</td>
                        <td>{text(row.address)}</td>
                        <td>{text(row.rating)}</td>
                        <td><div className="badge-stack">
                          {row.is_verified === true && <StatusBadge tone="ok">Verified</StatusBadge>}
                          {row.is_popular === true && <StatusBadge tone="muted">Popular</StatusBadge>}
                          {row.is_hotspot === true && <StatusBadge tone="warn">Hotspot</StatusBadge>}
                        </div></td>
                        {canManage && (
                          <td><div className="row-actions">
                            <button type="button" className="btn btn--ghost" onClick={() => editPlace(row)}>Edit</button>
                            <button type="button" className="btn btn--danger" onClick={() => {
                              if (!window.confirm(`Delete "${text(row.name)}"? This cannot be undone.`)) return;
                              void run(async () => { await nearsipApi.deletePlace(row.id); return `Deleted "${text(row.name)}".`; });
                            }}>Delete</button>
                          </div></td>
                        )}
                      </>
                    )}
                    {tab === 'reviews' && (
                      <>
                        <td>{text(row.comment ?? row.text ?? row.content)}</td>
                        <td>{text(row.place_id)}</td>
                        <td>{text(row.rating)}</td>
                        <td>{row.created_at ? new Date(String(row.created_at)).toLocaleDateString() : '—'}</td>
                        {canManage && (
                          <td><div className="row-actions">
                            <button type="button" className="btn btn--danger" onClick={() => {
                              if (!window.confirm('Delete this review?')) return;
                              void run(async () => { await nearsipApi.deleteReview(row.id); return 'Review deleted.'; });
                            }}>Delete</button>
                          </div></td>
                        )}
                      </>
                    )}
                    {tab === 'users' && (
                      <>
                        <td><strong>{text(row.full_name ?? row.name ?? row.username)}</strong><div className="muted table__sub">{text(row.email ?? row.id)}</div></td>
                        <td>{row.created_at ? new Date(String(row.created_at)).toLocaleDateString() : '—'}</td>
                        {canAccounts && (
                          <td><div className="row-actions">
                            <button type="button" className="btn btn--danger" onClick={() => {
                              if (!window.confirm('Disable this NearSip account? They will not be able to sign in.')) return;
                              void run(async () => { await nearsipApi.setUserDisabled(row.id, true); return 'Account disabled.'; });
                            }}>Disable</button>
                            <button type="button" className="btn btn--ghost" onClick={() =>
                              void run(async () => { await nearsipApi.setUserDisabled(row.id, false); return 'Account enabled.'; })}>Enable</button>
                          </div></td>
                        )}
                      </>
                    )}
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} className="muted">Nothing here yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
