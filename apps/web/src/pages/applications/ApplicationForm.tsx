import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  APP_STATUSES,
  DEPLOYMENT_ENVIRONMENTS,
  INTEGRATION_STATUSES,
  INTEGRATION_TYPES,
  type CreateApplicationInput,
} from '@slc/shared';

import { ApiClientError, applicationsApi } from '../../lib/api';
import { LoadingState } from '../../components/states';

type FormState = {
  slug: string;
  name: string;
  description: string;
  platform: string;
  frontendTechnology: string;
  backendTechnology: string;
  databaseTechnology: string;
  authenticationTechnology: string;
  repositoryUrl: string;
  productionUrl: string;
  stagingUrl: string;
  environment: string;
  integrationType: string;
  adapterType: string;
  integrationStatus: string;
  status: string;
  version: string;
  healthCheckEnabled: boolean;
};

const EMPTY: FormState = {
  slug: '',
  name: '',
  description: '',
  platform: '',
  frontendTechnology: '',
  backendTechnology: '',
  databaseTechnology: '',
  authenticationTechnology: '',
  repositoryUrl: '',
  productionUrl: '',
  stagingUrl: '',
  environment: 'UNKNOWN',
  integrationType: 'NONE',
  adapterType: '',
  integrationStatus: 'NOT_STARTED',
  status: 'UNKNOWN',
  version: '',
  healthCheckEnabled: false,
};

const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

export function ApplicationForm({ mode }: { mode: 'create' | 'edit' }) {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'edit') return;
    let active = true;
    applicationsApi
      .get(id)
      .then(({ application: a }) => {
        if (!active) return;
        setForm({
          slug: a.slug,
          name: a.name,
          description: a.description ?? '',
          platform: a.platform ?? '',
          frontendTechnology: a.frontendTechnology ?? '',
          backendTechnology: a.backendTechnology ?? '',
          databaseTechnology: a.databaseTechnology ?? '',
          authenticationTechnology: a.authenticationTechnology ?? '',
          repositoryUrl: a.repositoryUrl ?? '',
          productionUrl: a.productionUrl ?? '',
          stagingUrl: a.stagingUrl ?? '',
          environment: a.environment,
          integrationType: a.integrationType,
          adapterType: a.adapterType ?? '',
          integrationStatus: a.integrationStatus,
          status: a.status,
          version: a.version ?? '',
          healthCheckEnabled: a.healthCheckEnabled,
        });
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load application.'),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [mode, id]);

  const set = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      name: form.name.trim(),
      description: orNull(form.description),
      platform: orNull(form.platform),
      frontendTechnology: orNull(form.frontendTechnology),
      backendTechnology: orNull(form.backendTechnology),
      databaseTechnology: orNull(form.databaseTechnology),
      authenticationTechnology: orNull(form.authenticationTechnology),
      repositoryUrl: orNull(form.repositoryUrl),
      productionUrl: orNull(form.productionUrl),
      stagingUrl: orNull(form.stagingUrl),
      environment: form.environment as CreateApplicationInput['environment'],
      integrationType: form.integrationType as CreateApplicationInput['integrationType'],
      adapterType: orNull(form.adapterType),
      integrationStatus: form.integrationStatus as CreateApplicationInput['integrationStatus'],
      status: form.status as CreateApplicationInput['status'],
      version: orNull(form.version),
      healthCheckEnabled: form.healthCheckEnabled,
    };

    try {
      if (mode === 'create') {
        const { application } = await applicationsApi.create({
          slug: form.slug.trim(),
          ...payload,
        });
        navigate(`/applications/${application.id}`);
      } else {
        const { application } = await applicationsApi.update(id, payload);
        navigate(`/applications/${application.id}`);
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to save application.');
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="page">
        <LoadingState label="Loading…" />
      </section>
    );
  }

  const field = (label: string, key: keyof FormState, opts: { readOnly?: boolean } = {}) => (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        className="field__input"
        value={String(form[key])}
        readOnly={opts.readOnly}
        onChange={(e) => set({ [key]: e.target.value } as Partial<FormState>)}
      />
    </label>
  );

  const enumSelect = (label: string, key: keyof FormState, options: readonly string[]) => (
    <label className="field">
      <span className="field__label">{label}</span>
      <select
        className="field__input"
        value={String(form[key])}
        onChange={(e) => set({ [key]: e.target.value } as Partial<FormState>)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">
          {mode === 'create' ? 'New application' : `Edit ${form.name}`}
        </h1>
      </header>

      <form className="card form-grid" onSubmit={onSubmit}>
        {error && (
          <div className="login__error" role="alert">
            {error}
          </div>
        )}

        {mode === 'create'
          ? field('Slug (lowercase-kebab)', 'slug')
          : field('Slug', 'slug', { readOnly: true })}
        {field('Name', 'name')}
        {field('Description', 'description')}
        {field('Platform', 'platform')}
        {field('Frontend technology', 'frontendTechnology')}
        {field('Backend technology', 'backendTechnology')}
        {field('Database technology', 'databaseTechnology')}
        {field('Authentication technology', 'authenticationTechnology')}
        {field('Repository URL', 'repositoryUrl')}
        {field('Production URL', 'productionUrl')}
        {field('Staging URL', 'stagingUrl')}
        {enumSelect('Environment', 'environment', DEPLOYMENT_ENVIRONMENTS)}
        {enumSelect('Integration type', 'integrationType', INTEGRATION_TYPES)}
        {field('Adapter type', 'adapterType')}
        {enumSelect('Integration status', 'integrationStatus', INTEGRATION_STATUSES)}
        {enumSelect('Lifecycle status', 'status', APP_STATUSES)}
        {field('Version', 'version')}

        <label className="field field--checkbox">
          <input
            type="checkbox"
            checked={form.healthCheckEnabled}
            onChange={(e) => set({ healthCheckEnabled: e.target.checked })}
          />
          <span>Health check enabled</span>
        </label>

        <div className="form-actions">
          <button className="btn" type="submit" disabled={saving}>
            {saving ? 'Saving…' : mode === 'create' ? 'Create application' : 'Save changes'}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate('/applications')}
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
