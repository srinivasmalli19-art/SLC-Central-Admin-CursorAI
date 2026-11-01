import { useCallback, useEffect, useMemo, useState } from 'react';

import { ErrorState, LoadingState } from '../../../components/states';
import { StatusBadge } from '../../../components/StatusBadge';
import {
  jeevamitraApi,
  type JmCropDefault,
  type JmCropEdit,
  type JmCropSettings,
  type JmLang,
  type JmLocalized,
} from '../../../lib/api';

const LANGS: { code: JmLang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'hi', label: 'हिन्दी' },
];
const FIELDS = [
  { key: 'name', label: 'Crop name', rows: 1, max: 60 },
  { key: 'goodFor', label: 'Good for (what animals gain)', rows: 3, max: 600 },
  { key: 'risk', label: 'Risk — what happens with daily or heavy eating', rows: 4, max: 1200 },
  { key: 'precautions', label: 'Precautions', rows: 4, max: 1500 },
] as const;
type FieldKey = (typeof FIELDS)[number]['key'];
type Texts = Record<FieldKey, Record<JmLang, string>>;

interface Row {
  id: string;
  emoji: string;
  order: number;
  hidden: boolean;
  texts: Texts;
  isDefault: boolean;
  edited: boolean;
  reviewedBy: string;
  reviewedOn: string;
}

const blank = (): Record<JmLang, string> => ({ en: '', te: '', hi: '' });
const fill = (base: Partial<Record<JmLang, string>> | undefined, over: JmLocalized | undefined) => {
  const out = blank();
  for (const { code } of LANGS) out[code] = over?.[code] || base?.[code] || '';
  return out;
};

/** Built-in app cards with admin edits applied (same rule as the app). */
export function mergeRows(defaults: JmCropDefault[], edits: JmCropEdit[]): Row[] {
  const byId = new Map(edits.map((e) => [e.id, e]));
  const rows: Row[] = defaults.map((d) => {
    const e = byId.get(d.id);
    return {
      id: d.id, emoji: e?.emoji || d.emoji, order: e?.order ?? d.order, hidden: e?.hidden ?? false, isDefault: true, edited: !!e,
      reviewedBy: e?.reviewedBy ?? '', reviewedOn: e?.reviewedOn ?? '',
      texts: { name: fill(d.name, e?.name), goodFor: fill(d.goodFor, e?.goodFor), risk: fill(d.risk, e?.risk), precautions: fill(d.precautions, e?.precautions) },
    };
  });
  for (const e of edits) {
    if (defaults.some((d) => d.id === e.id)) continue;
    rows.push({
      id: e.id, emoji: e.emoji || '🌱', order: e.order ?? 999, hidden: e.hidden ?? false, isDefault: false, edited: true,
      reviewedBy: e.reviewedBy ?? '', reviewedOn: e.reviewedOn ?? '',
      texts: { name: fill({}, e.name), goodFor: fill({}, e.goodFor), risk: fill({}, e.risk), precautions: fill({}, e.precautions) },
    });
  }
  return rows.sort((a, b) => a.order - b.order);
}

/** What to store: only text that differs from the app's built-in card (empty = use built-in). */
export function editFor(row: Row, base: JmCropDefault | undefined): Omit<JmCropEdit, 'id'> {
  const out: Omit<JmCropEdit, 'id'> = { hidden: row.hidden, order: row.order };
  if (!base || row.emoji !== base.emoji) out.emoji = row.emoji;
  if (row.reviewedBy.trim()) out.reviewedBy = row.reviewedBy.trim();
  if (row.reviewedOn) out.reviewedOn = row.reviewedOn;
  for (const f of FIELDS) {
    const changed: JmLocalized = {};
    for (const { code } of LANGS) {
      const v = row.texts[f.key][code].trim();
      if (v && v !== (base?.[f.key][code] ?? '').trim()) changed[code] = v;
    }
    if (Object.keys(changed).length) out[f.key] = changed;
  }
  return out;
}

interface Props {
  canManage: boolean;
  onNotice: (text: string) => void;
}

export function CropGuidesPanel({ canManage, onNotice }: Props) {
  const [defaults, setDefaults] = useState<JmCropDefault[]>([]);
  const [defaultSettings, setDefaultSettings] = useState<JmCropSettings>({});
  const [edits, setEdits] = useState<JmCropEdit[]>([]);
  const [settings, setSettings] = useState<JmCropSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [editingSettings, setEditingSettings] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    jeevamitraApi
      .cropGuides()
      .then((r) => {
        setDefaults(r.defaults);
        setDefaultSettings(r.defaultSettings);
        setEdits(r.edits);
        setSettings(r.settings);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load crop cards.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => load(), [load]);

  const rows = useMemo(() => mergeRows(defaults, edits), [defaults, edits]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onNotice(done);
      setEditing(null);
      setEditingSettings(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState label="Loading crop safety cards…" />;

  if (editing) {
    const base = defaults.find((d) => d.id === editing.id);
    const setText = (f: FieldKey, l: JmLang, v: string) =>
      setEditing({ ...editing, texts: { ...editing.texts, [f]: { ...editing.texts[f], [l]: v } } });
    return (
      <form
        className="card"
        aria-label="Edit crop card"
        onSubmit={(e) => {
          e.preventDefault();
          if (!/^[a-z0-9_-]{1,64}$/.test(editing.id)) return setError('Crop id: lowercase letters, numbers, - or _ only.');
          void run(() => jeevamitraApi.saveCropGuide(editing.id, editFor(editing, base)), `Saved “${editing.texts.name.en || editing.id}”. Phones get it on next app open.`);
        }}
      >
        <h2 className="card__title">{base ? `Edit ${editing.emoji} ${base.name.en}` : 'New crop card'}</h2>
        {error && <div className="state state--error" role="alert">{error}</div>}
        <p className="muted">Text left the same as the app’s built-in card is not stored, so later app updates still reach it. Clear a box to go back to the built-in text.</p>
        <div className="form-grid">
          {!base && (
            <label className="field"><span className="field__label">Crop id (cannot change later)</span>
              <input className="field__input" value={editing.id} onChange={(e) => setEditing({ ...editing, id: e.target.value.toLowerCase() })} placeholder="e.g. foxtail_millet" required />
            </label>
          )}
          <label className="field"><span className="field__label">Emoji</span>
            <input className="field__input" value={editing.emoji} maxLength={8} onChange={(e) => setEditing({ ...editing, emoji: e.target.value })} />
          </label>
          <label className="field"><span className="field__label">Order in list</span>
            <input className="field__input" type="number" min={0} max={9999} value={editing.order} onChange={(e) => setEditing({ ...editing, order: Math.trunc(Number(e.target.value) || 0) })} />
          </label>
          <label className="field field--checkbox">
            <input type="checkbox" checked={editing.hidden} onChange={(e) => setEditing({ ...editing, hidden: e.target.checked })} /> Hide this crop in the app
          </label>
          <label className="field"><span className="field__label">Reviewed by (vet, university)</span>
            <input className="field__input" value={editing.reviewedBy} maxLength={120} onChange={(e) => setEditing({ ...editing, reviewedBy: e.target.value })} placeholder="e.g. Dr K. Rao, SVVU Tirupati" />
          </label>
          <label className="field"><span className="field__label">Reviewed on</span>
            <input className="field__input" type="date" value={editing.reviewedOn} onChange={(e) => setEditing({ ...editing, reviewedOn: e.target.value })} />
          </label>
        </div>
        {FIELDS.map((f) => (
          <fieldset key={f.key} className="field">
            <legend className="field__label"><strong>{f.label}</strong></legend>
            <div className="form-grid">
              {LANGS.map(({ code, label }) => (
                <label key={code} className="field"><span className="field__label">{label}</span>
                  <textarea className="field__input" rows={f.rows} maxLength={f.max} lang={code} value={editing.texts[f.key][code]} onChange={(e) => setText(f.key, code, e.target.value)} />
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="form-actions">
          <button type="submit" className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save card'}</button>
          <button type="button" className="btn btn--ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
        </div>
      </form>
    );
  }

  if (editingSettings) {
    return (
      <SettingsForm
        initial={settings ?? {}}
        defaults={defaultSettings}
        busy={busy}
        error={error}
        onCancel={() => setEditingSettings(false)}
        onSave={(s) => void run(() => jeevamitraApi.saveCropSettings(s), 'Saved general advice for all crops.')}
      />
    );
  }

  return (
    <>
      {error && <ErrorState message={error} onRetry={load} />}
      {canManage && (
        <div className="toolbar">
          <button type="button" className="btn" onClick={() => setEditing({ id: '', emoji: '🌱', order: 100, hidden: false, isDefault: false, edited: false, reviewedBy: '', reviewedOn: '', texts: { name: blank(), goodFor: blank(), risk: blank(), precautions: blank() } })}>
            + Add crop
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setEditingSettings(true)}>Edit general advice</button>
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Crop</th><th>Telugu / Hindi</th><th>Status</th><th>Reviewed</th>{canManage && <th aria-label="Actions" />}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.emoji} {r.texts.name.en || r.id}</strong><div className="muted table__sub">{r.id} · order {r.order}</div></td>
                <td>{r.texts.name.te || <span className="muted">—</span>} / {r.texts.name.hi || <span className="muted">—</span>}</td>
                <td>
                  <span className="badge-stack">
                    {r.hidden ? <StatusBadge tone="muted">Hidden</StatusBadge> : <StatusBadge tone="ok">Shown</StatusBadge>}
                    {!r.isDefault ? <StatusBadge tone="warn">Added by admin</StatusBadge> : r.edited ? <StatusBadge tone="warn">Edited</StatusBadge> : null}
                  </span>
                </td>
                <td>{r.reviewedBy ? <>{r.reviewedBy}<div className="muted table__sub">{r.reviewedOn}</div></> : <span className="muted">Not yet</span>}</td>
                {canManage && (
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn btn--ghost" onClick={() => setEditing(r)}>Edit</button>
                      {r.edited && (
                        <button
                          type="button"
                          className="btn btn--danger"
                          disabled={busy}
                          onClick={() => {
                            const msg = r.isDefault ? `Undo all admin edits to ${r.texts.name.en} and go back to the app’s built-in card?` : `Delete the crop “${r.texts.name.en || r.id}” from the app?`;
                            if (!window.confirm(msg)) return;
                            void run(() => jeevamitraApi.resetCropGuide(r.id), r.isDefault ? 'Back to the built-in card.' : 'Crop deleted.');
                          }}
                        >
                          {r.isDefault ? 'Reset' : 'Delete'}
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SettingsForm(props: {
  initial: JmCropSettings;
  defaults: JmCropSettings;
  busy: boolean;
  error: string | null;
  onSave: (s: JmCropSettings) => void;
  onCancel: () => void;
}) {
  const { initial, defaults } = props;
  const [days, setDays] = useState(initial.sprayWarningDays ?? defaults.sprayWarningDays ?? 21);
  const lines = (l: JmLang) => (initial.generalPrecautions?.[l] ?? defaults.generalPrecautions?.[l] ?? []).join('\n');
  const [general, setGeneral] = useState<Record<JmLang, string>>({ en: lines('en'), te: lines('te'), hi: lines('hi') });
  const [callVet, setCallVet] = useState(fill(defaults.callVet, initial.callVet));
  const [disclaimer, setDisclaimer] = useState(fill(defaults.disclaimer, initial.disclaimer));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const out: JmCropSettings = { sprayWarningDays: days, generalPrecautions: {}, callVet: {}, disclaimer: {} };
    for (const { code } of LANGS) {
      out.generalPrecautions![code] = general[code].split('\n').map((x) => x.trim()).filter(Boolean);
      if (callVet[code].trim() !== (defaults.callVet?.[code] ?? '')) out.callVet![code] = callVet[code].trim();
      if (disclaimer[code].trim() !== (defaults.disclaimer?.[code] ?? '')) out.disclaimer![code] = disclaimer[code].trim();
    }
    props.onSave(out);
  }

  return (
    <form className="card" onSubmit={submit} aria-label="General advice">
      <h2 className="card__title">General advice shown with every crop</h2>
      {props.error && <div className="state state--error" role="alert">{props.error}</div>}
      <div className="form-grid">
        <label className="field"><span className="field__label">Warn if sprayed within (days)</span>
          <input className="field__input" type="number" min={0} max={365} value={days} onChange={(e) => setDays(Math.trunc(Number(e.target.value) || 0))} />
        </label>
      </div>
      {[
        { title: 'General precautions (one per line)', value: general, set: setGeneral, rows: 7 },
        { title: '“Call a vet” text', value: callVet, set: setCallVet, rows: 3 },
        { title: 'Disclaimer', value: disclaimer, set: setDisclaimer, rows: 3 },
      ].map((block) => (
        <fieldset key={block.title} className="field">
          <legend className="field__label"><strong>{block.title}</strong></legend>
          <div className="form-grid">
            {LANGS.map(({ code, label }) => (
              <label key={code} className="field"><span className="field__label">{label}</span>
                <textarea className="field__input" rows={block.rows} lang={code} value={block.value[code]} onChange={(e) => block.set({ ...block.value, [code]: e.target.value })} />
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="form-actions">
        <button type="submit" className="btn" disabled={props.busy}>{props.busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn btn--ghost" onClick={props.onCancel} disabled={props.busy}>Cancel</button>
      </div>
    </form>
  );
}
