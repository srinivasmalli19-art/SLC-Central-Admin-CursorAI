import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { ErrorState, LoadingState } from '../../components/states';
import { KpiRow } from '../../components/KpiRow';
import { StatusBadge } from '../../components/StatusBadge';
import {
  ApiClientError,
  pasunestamApi,
  type PnCase,
  type PnCaseStatus,
  type PnCertificate,
  type PnScheme,
  type PnSchemeApplication,
  type PnSummary,
  type PnTemplate,
  type PnVet,
} from '../../lib/api';

const CLIENT = 'pasunestam-admin';
type Tab = 'cases' | 'certificates' | 'templates' | 'schemes' | 'vets' | 'applications';
const TAB_LABELS: Record<Tab, string> = {
  cases: 'Case review',
  certificates: 'Certificates',
  templates: 'Templates',
  schemes: 'Scheme forms',
  vets: 'Vets',
  applications: 'Scheme applications',
};

function message(err: unknown): string {
  return err instanceof ApiClientError || err instanceof Error ? err.message : 'Something went wrong.';
}
function day(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}
const certTone = (s: PnCertificate['status']) => (s === 'issued' ? 'ok' : s === 'cancelled' ? 'warn' : 'muted');

/** Pasunestam administration: case review, certificates, templates, scheme forms, vets. */
export function PasunestamPage() {
  const { hasAppRole } = useAuth();
  const isManager = hasAppRole(CLIENT, ['manager']);
  const tabs: Tab[] = isManager
    ? ['cases', 'certificates', 'templates', 'schemes', 'vets', 'applications']
    : ['cases', 'certificates', 'templates', 'schemes'];

  const [tab, setTab] = useState<Tab>('cases');
  const [summary, setSummary] = useState<PnSummary | null>(null);
  const [caseStatus, setCaseStatus] = useState<PnCaseStatus>('submitted');
  const [cases, setCases] = useState<PnCase[]>([]);
  const [certificates, setCertificates] = useState<PnCertificate[]>([]);
  const [certNumber, setCertNumber] = useState('');
  const [certQuery, setCertQuery] = useState('');
  const [templates, setTemplates] = useState<PnTemplate[]>([]);
  const [schemes, setSchemes] = useState<PnScheme[]>([]);
  const [vets, setVets] = useState<PnVet[]>([]);
  const [applications, setApplications] = useState<PnSchemeApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const list: Record<Tab, () => Promise<void>> = {
      cases: () => pasunestamApi.cases(caseStatus).then((r) => setCases(r.cases)),
      certificates: () =>
        pasunestamApi.certificates(certQuery ? { number: certQuery } : {}).then((r) => setCertificates(r.certificates)),
      templates: () => pasunestamApi.templates().then((r) => setTemplates(r.templates)),
      schemes: () => pasunestamApi.schemes().then((r) => setSchemes(r.schemes)),
      vets: () => pasunestamApi.vets().then((r) => setVets(r.items)),
      applications: () =>
        Promise.all([pasunestamApi.schemeApplications(), pasunestamApi.schemes()]).then(([a, sc]) => {
          setApplications(a.applications);
          setSchemes(sc.schemes);
        }),
    };
    Promise.all([pasunestamApi.summary().then(setSummary), list[tab]()])
      .catch((err: unknown) => setError(message(err)))
      .finally(() => setLoading(false));
  }, [tab, caseStatus, certQuery]);

  useEffect(() => load(), [load]);

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

  function onSearch(event: FormEvent) {
    event.preventDefault();
    setCertQuery(certNumber.trim());
  }

  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">Pasunestam</h1>
        <span className="badge badge--muted">Vet portal · Firebase</span>
      </header>

      {summary && (
        <KpiRow
          items={[
            { label: 'Cases awaiting review', value: summary.casesAwaitingReview, tone: 'warn' },
            { label: 'Certificates issued', value: summary.certificatesIssued },
            { label: 'Vets', value: summary.vets },
            { label: 'Scheme applications', value: summary.schemeApplications },
          ]}
        />
      )}

      {notice && <div className="notice" role="status">{notice}</div>}

      <div className="card">
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`tabs__tab ${tab === t ? 'tabs__tab--active' : ''}`} onClick={() => setTab(t)}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {tab === 'cases' && (
          <div className="toolbar">
            <select className="field__input toolbar__filter" aria-label="Case status" value={caseStatus} onChange={(e) => setCaseStatus(e.target.value as PnCaseStatus)}>
              <option value="submitted">Waiting for review</option>
              <option value="published">Published</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        )}
        {tab === 'certificates' && (
          <form className="toolbar" onSubmit={onSearch}>
            <input className="field__input toolbar__filter" aria-label="Certificate number" placeholder="Certificate number, e.g. HC-2026-0001" value={certNumber} onChange={(e) => setCertNumber(e.target.value)} />
            <button className="btn" type="submit">Find</button>
            {certQuery && (
              <button className="btn btn--ghost" type="button" onClick={() => { setCertNumber(''); setCertQuery(''); }}>
                Show recent
              </button>
            )}
          </form>
        )}

        {loading && <LoadingState label="Loading Pasunestam…" />}
        {error && !loading && <ErrorState message={error} onRetry={load} />}

        {!loading && !error && tab === 'cases' && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Case</th><th>Submitted by</th><th>Date</th><th>Status</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.title || '(untitled)'}</strong>
                      <div className="muted table__sub">{c.species}</div>
                      <details><summary>Read case</summary><p className="case-body">{c.body}</p></details>
                    </td>
                    <td>{c.submitterName}</td>
                    <td>{day(c.createdAt)}</td>
                    <td>
                      <StatusBadge tone={c.status === 'published' ? 'ok' : c.status === 'rejected' ? 'muted' : 'warn'}>
                        {c.status === 'submitted' ? 'Waiting' : c.status === 'published' ? 'Published' : 'Rejected'}
                      </StatusBadge>
                      {c.reviewedBy && <div className="muted table__sub">{c.reviewedBy}</div>}
                    </td>
                    <td>
                      <div className="row-actions">
                        {c.status !== 'published' && (
                          <button type="button" className="btn" disabled={busy === c.id}
                            onClick={() => void act(c.id, async () => {
                              await pasunestamApi.reviewCase(c.id, 'published');
                              return `“${c.title}” is published.`;
                            })}>
                            Publish
                          </button>
                        )}
                        {c.status !== 'rejected' && (
                          <button type="button" className="btn btn--ghost" disabled={busy === c.id}
                            onClick={() => void act(c.id, async () => {
                              await pasunestamApi.reviewCase(c.id, 'rejected');
                              return `“${c.title}” is rejected.`;
                            })}>
                            {c.status === 'published' ? 'Unpublish' : 'Reject'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {cases.length === 0 && <tr><td colSpan={5} className="muted">No cases here.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && tab === 'certificates' && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Number</th><th>Issued by</th><th>Issued</th><th>Status</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {certificates.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.number ?? <span className="muted">draft</span>}</strong></td>
                    <td>{c.vetName ?? <span className="muted">—</span>}<div className="muted table__sub">{[c.vetInstitution, c.vetDistrict].filter(Boolean).join(', ')}</div></td>
                    <td>{day(c.issuedAt ?? c.createdAt)}</td>
                    <td>
                      <StatusBadge tone={certTone(c.status)}>{c.status === 'issued' ? 'Issued' : c.status === 'cancelled' ? 'Cancelled' : 'Draft'}</StatusBadge>
                      {c.cancelledReason && <div className="muted table__sub">{c.cancelledReason}</div>}
                    </td>
                    <td>
                      {c.status === 'issued' && (
                        <button type="button" className="btn btn--danger" disabled={busy === c.id}
                          onClick={() => {
                            const reason = window.prompt(`Cancel certificate ${c.number}? It will stop verifying on the public verify page.\n\nReason:`);
                            if (!reason || reason.trim().length < 3) return;
                            void act(c.id, async () => {
                              await pasunestamApi.cancelCertificate(c.id, reason.trim());
                              return `Certificate ${c.number} is cancelled.`;
                            });
                          }}>
                          Cancel certificate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {certificates.length === 0 && <tr><td colSpan={5} className="muted">{certQuery ? `No certificate numbered ${certQuery}.` : 'No certificates yet.'}</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && tab === 'templates' && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Template</th><th>Number prefix</th><th>Status</th>{isManager && <th aria-label="Actions" />}</tr></thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td><strong>{t.name}</strong><div className="muted table__sub">{t.key}</div></td>
                    <td>{t.numberPrefix}</td>
                    <td><StatusBadge tone={t.published ? 'ok' : 'muted'}>{t.published ? 'Available to vets' : 'Hidden'}</StatusBadge></td>
                    {isManager && (
                      <td>
                        <button type="button" className="btn btn--ghost" disabled={busy === t.id}
                          onClick={() => void act(t.id, async () => {
                            await pasunestamApi.setTemplatePublished(t.id, !t.published);
                            return `${t.name} is ${t.published ? 'hidden from' : 'available to'} vets.`;
                          })}>
                          {t.published ? 'Hide' : 'Make available'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {templates.length === 0 && <tr><td colSpan={4} className="muted">No templates.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && tab === 'schemes' && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Form</th><th>Type</th><th>Added</th>{isManager && <th aria-label="Actions" />}</tr></thead>
              <tbody>
                {schemes.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.name}</strong>
                      {s.fileUrl && <div className="table__sub"><a href={s.fileUrl} target="_blank" rel="noreferrer noopener">{s.fileName ?? 'file'}</a></div>}
                    </td>
                    <td>{s.tag}</td>
                    <td>{day(s.createdAt)}</td>
                    {isManager && (
                      <td>
                        <button type="button" className="btn btn--danger" disabled={busy === s.id}
                          onClick={() => {
                            if (!window.confirm(`Remove “${s.name}” and its file from Pasunestam?`)) return;
                            void act(s.id, async () => {
                              await pasunestamApi.deleteScheme(s.id);
                              return `“${s.name}” is removed.`;
                            });
                          }}>
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {schemes.length === 0 && <tr><td colSpan={4} className="muted">No scheme forms.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && tab === 'vets' && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Vet</th><th>Registration</th><th>Institution</th><th>Account</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {vets.map((v) => (
                  <tr key={v.uid}>
                    <td><strong>{v.fullName ?? '(no name)'}</strong><div className="muted table__sub">{v.email}</div></td>
                    <td>{v.registrationNo ?? <span className="muted">—</span>}</td>
                    <td>{[v.institution, v.district].filter(Boolean).join(', ') || <span className="muted">—</span>}</td>
                    <td><StatusBadge tone={v.disabled ? 'warn' : 'ok'}>{v.disabled ? 'Disabled' : 'Active'}</StatusBadge></td>
                    <td>
                      <button type="button" className={v.disabled ? 'btn' : 'btn btn--danger'} disabled={busy === v.uid}
                        onClick={() => {
                          if (!v.disabled && !window.confirm(`Disable ${v.fullName ?? 'this vet'}'s Pasunestam account and sign them out?`)) return;
                          void act(v.uid, async () => {
                            await pasunestamApi.setVetDisabled(v.uid, !v.disabled);
                            return `${v.fullName ?? 'Vet'} is ${v.disabled ? 'enabled' : 'disabled'}.`;
                          });
                        }}>
                        {v.disabled ? 'Enable' : 'Disable'}
                      </button>
                    </td>
                  </tr>
                ))}
                {vets.length === 0 && <tr><td colSpan={5} className="muted">No vets yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && tab === 'applications' && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Applicant</th><th>Mobile</th><th>Village</th><th>Animals</th><th>Taken down</th></tr></thead>
              <tbody>
                {applications.map((a) => (
                  <tr key={a.id}>
                    <td><strong>{a.applicantName}</strong><div className="muted table__sub">{schemes.find((s) => s.id === a.schemeId)?.name ?? a.schemeId}</div></td>
                    <td>{a.mobile}</td>
                    <td>{a.village}</td>
                    <td>{a.animalCount}</td>
                    <td>{day(a.createdAt)}</td>
                  </tr>
                ))}
                {applications.length === 0 && <tr><td colSpan={5} className="muted">No applications yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
