import { useState } from 'react';

import type { JmVet } from '../../../lib/api';

// The app shows these exact words (and translates them on the phone).
export const SECTORS = ['Government', 'Private'];
export const DESIGNATIONS = ['Veterinary Officer', 'Veterinary Assistant'];
export const SERVICES = ['General Checkup', 'Vaccination', 'First Aid', 'Artificial Insemination', 'Surgery', 'Epidemic Response'];
export const LANGUAGES = ['Telugu', 'English', 'Hindi'];
export const AVAILABILITY = ['Available today', 'Available tomorrow', 'Busy this week'];

export const EMPTY_VET: JmVet = {
  name: '', sector: 'Government', designation: 'Veterinary Officer', services: ['General Checkup'], experienceYears: 0,
  languages: ['Telugu'], village: '', district: '', phone: '', rating: null, availability: 'Available today', lat: null, lng: null,
};

interface Props {
  initial: JmVet;
  title: string;
  busy: boolean;
  onSave: (vet: JmVet) => void;
  onCancel: () => void;
}

/** Add or edit one entry of the app's vet directory. */
export function VetForm({ initial, title, busy, onSave, onCancel }: Props) {
  const [vet, setVet] = useState<JmVet>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof JmVet>(key: K, value: JmVet[K]) => setVet((v) => ({ ...v, [key]: value }));
  const toggle = (key: 'services' | 'languages', value: string) =>
    setVet((v) => ({ ...v, [key]: v[key].includes(value) ? v[key].filter((x) => x !== value) : [...v[key], value] }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (vet.name.trim().length < 2) return setProblem('Enter the vet’s name.');
    if (!/^\d{10}$/.test(vet.phone)) return setProblem('Phone must be 10 digits (no +91).');
    if (!vet.village.trim() || !vet.district.trim()) return setProblem('Enter village and district.');
    if (vet.languages.length === 0) return setProblem('Pick at least one language.');
    if ((vet.lat === null) !== (vet.lng === null)) return setProblem('Enter both latitude and longitude, or neither.');
    setProblem(null);
    onSave({ ...vet, name: vet.name.trim(), village: vet.village.trim(), district: vet.district.trim() });
  }

  const num = (v: string): number | null => (v.trim() === '' ? null : Number(v));

  return (
    <form className="card" onSubmit={submit} aria-label={title}>
      <h2 className="card__title">{title}</h2>
      {problem && <div className="state state--error" role="alert">{problem}</div>}
      <div className="form-grid">
        <label className="field"><span className="field__label">Name</span>
          <input className="field__input" value={vet.name} onChange={(e) => set('name', e.target.value)} maxLength={120} required />
        </label>
        <label className="field"><span className="field__label">Phone (10 digits)</span>
          <input className="field__input" inputMode="numeric" value={vet.phone} onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))} required />
        </label>
        <label className="field"><span className="field__label">Sector</span>
          <select className="field__input" value={vet.sector} onChange={(e) => set('sector', e.target.value)}>
            {SECTORS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="field"><span className="field__label">Designation</span>
          <select className="field__input" value={vet.designation} onChange={(e) => set('designation', e.target.value)}>
            {DESIGNATIONS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="field"><span className="field__label">Village</span>
          <input className="field__input" value={vet.village} onChange={(e) => set('village', e.target.value)} maxLength={80} required />
        </label>
        <label className="field"><span className="field__label">District</span>
          <input className="field__input" value={vet.district} onChange={(e) => set('district', e.target.value)} maxLength={80} required />
        </label>
        <label className="field"><span className="field__label">Experience (years)</span>
          <input className="field__input" type="number" min={0} max={70} value={vet.experienceYears} onChange={(e) => set('experienceYears', Math.max(0, Math.trunc(Number(e.target.value) || 0)))} />
        </label>
        <label className="field"><span className="field__label">Rating (1–5, optional)</span>
          <input className="field__input" type="number" min={1} max={5} step={0.1} value={vet.rating ?? ''} onChange={(e) => set('rating', num(e.target.value))} />
        </label>
        <label className="field"><span className="field__label">Availability</span>
          <select className="field__input" value={vet.availability} onChange={(e) => set('availability', e.target.value)}>
            {AVAILABILITY.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="field"><span className="field__label">Latitude (optional, for “near me”)</span>
          <input className="field__input" type="number" step="any" value={vet.lat ?? ''} onChange={(e) => set('lat', num(e.target.value))} />
        </label>
        <label className="field"><span className="field__label">Longitude (optional)</span>
          <input className="field__input" type="number" step="any" value={vet.lng ?? ''} onChange={(e) => set('lng', num(e.target.value))} />
        </label>
        <fieldset className="field"><legend className="field__label">Services</legend>
          {SERVICES.map((s) => (
            <label key={s} className="field field--checkbox">
              <input type="checkbox" checked={vet.services.includes(s)} onChange={() => toggle('services', s)} /> {s}
            </label>
          ))}
        </fieldset>
        <fieldset className="field"><legend className="field__label">Languages spoken</legend>
          {LANGUAGES.map((s) => (
            <label key={s} className="field field--checkbox">
              <input type="checkbox" checked={vet.languages.includes(s)} onChange={() => toggle('languages', s)} /> {s}
            </label>
          ))}
        </fieldset>
        <div className="form-actions">
          <button type="submit" className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save vet'}</button>
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </div>
    </form>
  );
}
