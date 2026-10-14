import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { AppRoleMap, IdentityUser, ManagedApp } from '@slc/shared';

import { useAuth } from '../../auth/AuthContext';
import { ErrorState, LoadingState } from '../../components/states';
import { StatusBadge } from '../../components/StatusBadge';
import { ApiClientError, identityApi } from '../../lib/api';

/**
 * Admin access: every SLC administrator (held in Keycloak), the role they hold
 * in each SLC app, and the controls to invite, change access, sign out
 * everywhere, or disable. The backend enforces every rule; this page only
 * hides controls the signed-in admin cannot use.
 */

function displayName(user: IdentityUser): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
  return name || user.email || user.id;
}

function errorText(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong.';
}

interface AccessEditorProps {
  apps: ManagedApp[];
  initial: AppRoleMap;
  onChange: (value: AppRoleMap) => void;
}

/** One row per SLC app; check the roles this person should hold there. */
function AccessEditor({ apps, initial, onChange }: AccessEditorProps) {
  const [value, setValue] = useState<AppRoleMap>(initial);

  function toggle(clientId: string, role: string) {
    const current = new Set(value[clientId] ?? []);
    if (current.has(role)) current.delete(role);
    else current.add(role);
    const next = { ...value, [clientId]: [...current].sort() };
    setValue(next);
    onChange(next);
  }

  return (
    <div className="access-editor" role="group" aria-label="Access per app">
      {apps.map((app) => (
        <fieldset key={app.clientId} className="access-editor__app">
          <legend className="access-editor__name">{app.name}</legend>
          <div className="access-editor__roles">
            {app.roles.length === 0 && <span className="muted">No roles defined</span>}
            {app.roles.map((role) => (
              <label key={role} className="field--checkbox access-editor__role">
                <input
                  type="checkbox"
                  checked={(value[app.clientId] ?? []).includes(role)}
                  onChange={() => toggle(app.clientId, role)}
                />
                <span>{role}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export function AdminAccess() {
  const { can } = useAuth();
  const canManage = can('admin_users.manage');

  const [apps, setApps] = useState<ManagedApp[] | null>(null);
  const [users, setUsers] = useState<IdentityUser[] | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Invite / edit panel state.
  const [panel, setPanel] = useState<{ mode: 'invite' } | { mode: 'edit'; user: IdentityUser } | null>(null);
  const [draftRoles, setDraftRoles] = useState<AppRoleMap>({});
  const [invite, setInvite] = useState({ email: '', firstName: '', lastName: '' });
  const [saving, setSaving] = useState(false);

  const appName = useMemo(() => new Map((apps ?? []).map((a) => [a.clientId, a.name])), [apps]);

  const load = useCallback((term?: string) => {
    setLoading(true);
    setError(null);
    Promise.all([identityApi.apps(), identityApi.users(term || undefined)])
      .then(([appsRes, usersRes]) => {
        setApps(appsRes.apps);
        setUsers(usersRes.users);
      })
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  function replaceUser(updated: IdentityUser) {
    setUsers((prev) => (prev ? prev.map((u) => (u.id === updated.id ? updated : u)) : prev));
  }

  async function runAction(user: IdentityUser, action: 'disable' | 'enable' | 'signout' | 'resend') {
    const label = displayName(user);
    const confirmText: Record<typeof action, string | null> = {
      disable: `Disable ${label}? They will be signed out of every SLC app and unable to sign in.`,
      enable: null,
      signout: `Sign ${label} out of every SLC app now?`,
      resend: null,
    };
    if (confirmText[action] && !window.confirm(confirmText[action]!)) return;

    setBusyId(user.id);
    setActionError(null);
    setNotice(null);
    try {
      if (action === 'disable' || action === 'enable') {
        const { user: updated } = await identityApi.setEnabled(user.id, action === 'enable');
        replaceUser(updated);
        setNotice(action === 'enable' ? `${label} can sign in again.` : `${label} is disabled and signed out everywhere.`);
      } else if (action === 'signout') {
        await identityApi.signOut(user.id);
        setNotice(`${label} was signed out of every SLC app.`);
      } else {
        await identityApi.resendInvite(user.id);
        setNotice(`Set-up email sent to ${user.email}.`);
      }
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setBusyId(null);
    }
  }

  function openInvite() {
    setPanel({ mode: 'invite' });
    setInvite({ email: '', firstName: '', lastName: '' });
    setDraftRoles({});
    setActionError(null);
    setNotice(null);
  }

  function openEdit(user: IdentityUser) {
    setPanel({ mode: 'edit', user });
    setDraftRoles(user.appRoles);
    setActionError(null);
    setNotice(null);
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!panel || !apps) return;
    setSaving(true);
    setActionError(null);
    try {
      if (panel.mode === 'invite') {
        const roles = Object.fromEntries(Object.entries(draftRoles).filter(([, r]) => r.length > 0));
        const result = await identityApi.invite({
          email: invite.email,
          firstName: invite.firstName || undefined,
          lastName: invite.lastName || undefined,
          appRoles: roles,
        });
        setUsers((prev) => [result.user, ...(prev ?? [])]);
        setNotice(
          result.invitationEmailSent
            ? `Invited ${result.user.email}. They will get an email to set a password and an authenticator app.`
            : `Created ${result.user.email}, but the invitation email could not be sent. Check the identity provider's email settings, then use "Resend set-up email".`,
        );
      } else {
        // Send every app so removed roles are removed too.
        const roles: AppRoleMap = Object.fromEntries(apps.map((a) => [a.clientId, draftRoles[a.clientId] ?? []]));
        const { user } = await identityApi.setRoles(panel.user.id, roles);
        replaceUser(user);
        setNotice(`Access updated for ${displayName(user)}.`);
      }
      setPanel(null);
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">Admin access</h1>
        <span className="badge badge--muted">All SLC apps</span>
        <div className="page__header-actions">
          {canManage && apps && (
            <button type="button" className="btn" onClick={openInvite}>
              Invite admin
            </button>
          )}
        </div>
      </header>

      <p className="muted page__lead">
        One sign-in for every SLC app. Each person's role in each app is set here and takes effect at their next
        sign-in. Disabling someone signs them out everywhere.
      </p>

      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {actionError && !panel && (
        <div className="login__error" role="alert">
          {actionError}
        </div>
      )}

      {panel && apps && (
        <form className="card access-panel" onSubmit={onSave} aria-label={panel.mode === 'invite' ? 'Invite admin' : 'Edit access'}>
          <div className="card__header">
            <h2 className="card__title">
              {panel.mode === 'invite' ? 'Invite an admin' : `Access for ${displayName(panel.user)}`}
            </h2>
          </div>
          {panel.mode === 'invite' && (
            <div className="form-grid">
              <label className="field">
                <span className="field__label">Email</span>
                <input
                  className="field__input"
                  type="email"
                  required
                  value={invite.email}
                  onChange={(e) => setInvite({ ...invite, email: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field__label">First name</span>
                <input
                  className="field__input"
                  value={invite.firstName}
                  onChange={(e) => setInvite({ ...invite, firstName: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field__label">Last name</span>
                <input
                  className="field__input"
                  value={invite.lastName}
                  onChange={(e) => setInvite({ ...invite, lastName: e.target.value })}
                />
              </label>
            </div>
          )}
          {panel.mode === 'edit' && panel.user.groups.length > 0 && (
            <p className="muted">
              Also inherits roles from: {panel.user.groups.join(', ')} (managed in the identity provider).
            </p>
          )}
          <AccessEditor
            key={panel.mode === 'edit' ? panel.user.id : 'invite'}
            apps={apps}
            initial={draftRoles}
            onChange={setDraftRoles}
          />
          {actionError && (
            <div className="login__error" role="alert">
              {actionError}
            </div>
          )}
          <div className="form-actions">
            <button className="btn" type="submit" disabled={saving}>
              {saving ? 'Saving…' : panel.mode === 'invite' ? 'Send invitation' : 'Save access'}
            </button>
            <button className="btn btn--ghost" type="button" onClick={() => setPanel(null)} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="card">
        <div className="toolbar">
          <form
            className="toolbar__search"
            onSubmit={(e) => {
              e.preventDefault();
              load(search);
            }}
          >
            <input
              className="field__input"
              type="search"
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search admins"
            />
          </form>
        </div>

        {loading && <LoadingState label="Loading admins…" />}
        {error && !loading && <ErrorState message={error} onRetry={() => load(search)} />}

        {users && !loading && !error && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Admin</th>
                  <th>Status</th>
                  <th>Access per app</th>
                  {canManage && <th aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const entries = Object.entries(user.appRoles).filter(([, roles]) => roles.length > 0);
                  return (
                    <tr key={user.id}>
                      <td>
                        <strong>{displayName(user)}</strong>
                        <div className="muted table__sub">{user.email}</div>
                      </td>
                      <td>
                        <div className="badge-stack">
                          <StatusBadge tone={user.enabled ? 'ok' : 'down'}>{user.enabled ? 'Active' : 'Disabled'}</StatusBadge>
                          <StatusBadge tone={user.mfaEnrolled ? 'ok' : 'warn'}>
                            {user.mfaEnrolled ? 'MFA on' : 'MFA not set up'}
                          </StatusBadge>
                          {user.pendingActions.length > 0 && <StatusBadge tone="muted">Invite pending</StatusBadge>}
                        </div>
                      </td>
                      <td>
                        {entries.length === 0 && user.groups.length === 0 && <span className="muted">No access</span>}
                        <ul className="role-list">
                          {entries.map(([clientId, roles]) => (
                            <li key={clientId}>
                              <span className="role-list__app">{appName.get(clientId) ?? clientId}</span>
                              <span className="role-list__roles">{roles.join(', ')}</span>
                            </li>
                          ))}
                          {user.groups.map((group) => (
                            <li key={group}>
                              <span className="role-list__app">Group</span>
                              <span className="role-list__roles">{group.replace(/^\//, '')}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                      {canManage && (
                        <td>
                          <div className="row-actions">
                            <button type="button" className="btn btn--ghost" disabled={busyId === user.id} onClick={() => openEdit(user)}>
                              Edit access
                            </button>
                            {user.pendingActions.length > 0 && (
                              <button type="button" className="btn btn--ghost" disabled={busyId === user.id} onClick={() => void runAction(user, 'resend')}>
                                Resend set-up email
                              </button>
                            )}
                            <button type="button" className="btn btn--ghost" disabled={busyId === user.id} onClick={() => void runAction(user, 'signout')}>
                              Sign out everywhere
                            </button>
                            <button
                              type="button"
                              className={user.enabled ? 'btn btn--danger' : 'btn btn--ghost'}
                              disabled={busyId === user.id}
                              onClick={() => void runAction(user, user.enabled ? 'disable' : 'enable')}
                            >
                              {user.enabled ? 'Disable' : 'Enable'}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 4 : 3} className="muted">
                      No admins found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
