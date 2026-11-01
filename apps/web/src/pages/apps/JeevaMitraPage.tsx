import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { ErrorState, LoadingState } from '../../components/states';
import { KpiRow } from '../../components/KpiRow';
import { StatusBadge } from '../../components/StatusBadge';
import { ApiClientError, jeevamitraApi, type JmItem, type JmKind, type JmProfileType, type JmSummary, type JmUser, type JmVet } from '../../lib/api';
import { CropGuidesPanel } from './jeevamitra/CropGuidesPanel';
import { EMPTY_VET, VetForm } from './jeevamitra/VetForm';

const CLIENT = 'jeevamitra-admin';
type Tab = 'users' | JmKind | 'cropGuides';
const TABS: { id: Tab; label: string }[] = [
  { id: 'users', label: 'Users' },
  { id: 'lands', label: 'Lands' },
  { id: 'fieldPosts', label: 'Field & herd posts' },
  { id: 'alerts', label: 'Disease alerts' },
  { id: 'vets', label: 'Vets' },
  { id: 'cropGuides', label: 'Crop safety cards' },
  { id: 'stories', label: 'Stories' },
  { id: 'videos', label: 'Videos' },
];
/** Posts made by app users: deleting them needs super_admin; managers pause. */
const USER_CONTENT: JmKind[] = ['lands', 'alerts', 'fieldPosts'];
const PROFILE_LABEL: Record<string, string> = { livestock: 'Livestock owner', land: 'Fodder land provider', both: 'Both' };
const NOUN: Record<JmKind, string> = { lands: 'land', alerts: 'alert', vets: 'vet', stories: 'story', videos: 'video', fieldPosts: 'post' };

function message(err: unknown): string {
  return err instanceof ApiClientError || err instanceof Error ? err.message : 'Something went wrong.';
}
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/**
 * JeevaMitra administration for the live app: people, lands, field and herd
 * posts, disease alerts, the vet directory, crop safety cards, stories, videos.
 * viewer = read; manager = pause/resume and curate content; super_admin = also
 * delete user posts and switch accounts off/on.
 */
export function JeevaMitraPage() {
  const { hasAppRole } = useAuth();
  const canManage = hasAppRole(CLIENT, ['manager', 'super_admin']);
  const isSuper = hasAppRole(CLIENT, ['super_admin']);

  const [tab, setTab] = useState<Tab>('users');
  const [summary, setSummary] = useState<JmSummary | null>(null);
  const [users, setUsers] = useState<JmUser[]>([]);
  const [items, setItems] = useState<JmItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [profileType, setProfileType] = useState<JmProfileType | ''>('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [vetForm, setVetForm] = useState<{ id: string | null; vet: JmVet } | null>(null);

  // Answers to an older request (e.g. from the previous tab) are ignored.
  const requestId = useRef(0);
  // Only a full 10-digit number filters (so typing does not reload on every key).
  const phoneQuery = /^\d{10}$/.test(phone) ? phone : '';
  const load = useCallback(
    (after?: string) => {
      const id = ++requestId.current;
      const current = () => id === requestId.current;
      setLoading(true);
      setError(null);
      const list: Promise<unknown> =
        tab === 'cropGuides'
          ? Promise.resolve()
          : tab === 'users'
            ? jeevamitraApi
                .users({ profileType: profileType || undefined, phone: phoneQuery || undefined, after })
                .then((r) => {
                  if (!current()) return;
                  setUsers((prev) => (after ? [...prev, ...r.items] : r.items));
                  setCursor(r.nextCursor);
                })
            : jeevamitraApi.content(tab, after).then((r) => {
                if (!current()) return;
                setItems((prev) => (after ? [...prev, ...r.items] : r.items));
                setCursor(r.nextCursor);
              });
      Promise.all([after ? null : jeevamitraApi.summary().then(setSummary), list])
        .catch((err: unknown) => current() && setError(message(err)))
        .finally(() => current() && setLoading(false));
    },
    [tab, profileType, phoneQuery],
  );

  useEffect(() => {
    setVetForm(null);
    load();
  }, [load]);

  async function act(key: string, fn: () => Promise<string>) {
    setBusy(key);
    setNotice(null);
    setError(null);
    try {
      setNotice(await fn());
      load();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  async function openVet(id: string | null) {
    if (!id) return setVetForm({ id: null, vet: EMPTY_VET });
    setBusy(id);
    try {
      setVetForm({ id, vet: (await jeevamitraApi.vet(id)).vet });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  const kind = tab !== 'users' && tab !== 'cropGuides' ? tab : null;
  const canDelete = (k: JmKind) => (USER_CONTENT.includes(k) ? isSuper : canManage);

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
            { label: 'Lands', value: summary.lands },
            { label: 'Field & herd posts', value: summary.fieldPosts },
            { label: 'Booking requests waiting', value: summary.bookingsPending, tone: 'warn' },
            { label: 'Active disease alerts', value: summary.alerts, tone: 'warn' },
            { label: 'Vets listed', value: summary.vets },
            { label: 'Chats', value: summary.chats },
          ]}
        />
      )}

      {notice && <div className="notice" role="status">{notice}</div>}

      <div className="card">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`tabs__tab ${tab === t.id ? 'tabs__tab--active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'cropGuides' && <CropGuidesPanel canManage={canManage} onNotice={setNotice} />}

        {tab === 'users' && (
          <div className="toolbar">
            <select className="field__input toolbar__filter" aria-label="Filter by profile" value={profileType} onChange={(e) => setProfileType(e.target.value as JmProfileType | '')}>
              <option value="">Everyone</option>
              <option value="livestock">Livestock owners</option>
              <option value="land">Fodder land providers</option>
              <option value="both">Both</option>
            </select>
            <input className="field__input toolbar__search" aria-label="Find by phone" placeholder="Find by 10-digit phone" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} />
          </div>
        )}

        {tab === 'vets' && canManage && !vetForm && (
          <div className="toolbar">
            <button type="button" className="btn" onClick={() => void openVet(null)}>+ Add vet</button>
          </div>
        )}
        {tab === 'vets' && vetForm && (
          <VetForm
            key={vetForm.id ?? 'new'}
            initial={vetForm.vet}
            title={vetForm.id ? `Edit ${vetForm.vet.name}` : 'Add a vet to the directory'}
            busy={busy === 'vet-form'}
            onCancel={() => setVetForm(null)}
            onSave={(vet) =>
              void act('vet-form', async () => {
                if (vetForm.id) await jeevamitraApi.updateVet(vetForm.id, vet);
                else await jeevamitraApi.createVet(vet);
                setVetForm(null);
                return `${vet.name} ${vetForm.id ? 'updated' : 'added'}. It shows in the app now.`;
              })
            }
          />
        )}

        {tab !== 'cropGuides' && loading && <LoadingState label="Loading JeevaMitra…" />}
        {tab !== 'cropGuides' && error && !loading && <ErrorState message={error} onRetry={() => load()} />}

        {tab === 'users' && !error && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Name</th><th>Profile</th><th>Place</th><th>Sign-in</th>{isSuper && <th aria-label="Actions" />}</tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.uid}>
                    <td><strong>{u.name || '(no name)'}</strong><div className="muted table__sub">{u.phone || '—'}</div></td>
                    <td>{PROFILE_LABEL[u.profileType] ?? <span className="muted">not set</span>}</td>
                    <td>{[u.village, u.district].filter(Boolean).join(', ') || <span className="muted">—</span>}</td>
                    <td>
                      {u.disabled === null ? <StatusBadge tone="muted">No account</StatusBadge> : u.disabled ? <StatusBadge tone="down">Switched off</StatusBadge> : <StatusBadge tone="ok">Active</StatusBadge>}
                    </td>
                    {isSuper && (
                      <td>
                        {u.disabled !== null && (
                          <div className="row-actions">
                            <button
                              type="button"
                              className={u.disabled ? 'btn' : 'btn btn--danger'}
                              disabled={busy === u.uid}
                              onClick={() => {
                                const q = u.disabled ? `Switch ${u.name || 'this user'}'s account back on?` : `Switch off ${u.name || 'this user'}'s JeevaMitra account and sign them out on every phone?`;
                                if (!window.confirm(q)) return;
                                void act(u.uid, async () => {
                                  await jeevamitraApi.setDisabled(u.uid, !u.disabled);
                                  return `${u.name || 'User'} is ${u.disabled ? 'active again' : 'switched off'}.`;
                                });
                              }}
                            >
                              {u.disabled ? 'Enable account' : 'Disable account'}
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {!loading && users.length === 0 && <tr><td colSpan={5} className="muted">No users found.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {kind && !error && !vetForm && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Item</th><th>Posted</th><th>Status</th>{canManage && <th aria-label="Actions" />}</tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td><strong>{it.title}</strong><div className="muted table__sub">{it.subtitle}</div></td>
                    <td className="nowrap">{date(it.createdAt)}</td>
                    <td>
                      <span className="badge-stack">
                        {it.hidden ? <StatusBadge tone="muted">{kind === 'alerts' ? 'Withdrawn' : 'Paused'}</StatusBadge> : <StatusBadge tone="ok">Live</StatusBadge>}
                        {it.status && kind === 'fieldPosts' && <StatusBadge tone="muted">{it.status}</StatusBadge>}
                      </span>
                    </td>
                    {canManage && (
                      <td>
                        <div className="row-actions">
                          {kind === 'vets' && (
                            <button type="button" className="btn btn--ghost" disabled={busy === it.id} onClick={() => void openVet(it.id)}>Edit</button>
                          )}
                          <button
                            type="button"
                            className="btn btn--ghost"
                            disabled={busy === it.id}
                            onClick={() =>
                              void act(it.id, async () => {
                                await jeevamitraApi.setHidden(kind, it.id, !it.hidden);
                                return `“${it.title}” ${it.hidden ? 'is live again' : 'is paused — hidden in the app (v1.4.0+)'}.`;
                              })
                            }
                          >
                            {it.hidden ? 'Resume' : 'Pause'}
                          </button>
                          {canDelete(kind) && (
                            <button
                              type="button"
                              className="btn btn--danger"
                              disabled={busy === it.id}
                              onClick={() => {
                                if (!window.confirm(`Delete this ${NOUN[kind]} for good? “${it.title}”. This cannot be undone.`)) return;
                                void act(it.id, async () => {
                                  const r = await jeevamitraApi.remove(kind, it.id);
                                  return `Deleted “${it.title}”${r.filesDeleted ? ` and ${r.filesDeleted} file(s)` : ''}.`;
                                });
                              }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {!loading && items.length === 0 && <tr><td colSpan={4} className="muted">Nothing here yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab !== 'cropGuides' && cursor && !loading && !error && (
          <div className="pagination">
            <button type="button" className="btn btn--ghost" onClick={() => load(cursor)}>Load more</button>
          </div>
        )}
      </div>
    </section>
  );
}
