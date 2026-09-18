import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Application } from '@slc/shared';

import { applicationsApi, ApiClientError } from '../../lib/api';
import { show } from '../../lib/display';
import { useAuth } from '../../auth/AuthContext';
import { ErrorState, LoadingState } from '../../components/states';
import { StatusBadge } from '../../components/StatusBadge';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function ApplicationDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [app, setApp] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    applicationsApi
      .get(id)
      .then((res) => active && setApp(res.application))
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiClientError && err.status === 404) {
          setError('Application not found.');
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load application.');
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return (
      <section className="page">
        <LoadingState label="Loading application…" />
      </section>
    );
  }
  if (error || !app) {
    return (
      <section className="page">
        <header className="page__header">
          <h1 className="page__title">Application</h1>
        </header>
        <ErrorState message={error ?? 'Not found.'} />
        <Link className="btn" to="/applications">
          Back to applications
        </Link>
      </section>
    );
  }

  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">{app.name}</h1>
        <StatusBadge tone={app.status === 'PRODUCTION' ? 'ok' : 'muted'}>{app.status}</StatusBadge>
        <div className="page__header-actions">
          <Link className="btn btn--ghost" to="/applications">
            Back
          </Link>
          {can('applications.manage') && (
            <Link className="btn" to={`/applications/${app.id}/edit`}>
              Edit
            </Link>
          )}
        </div>
      </header>

      <div className="card">
        <h2 className="card__title">Overview</h2>
        <p>{show(app.description)}</p>
      </div>

      <div className="detail-grid">
        <div className="card">
          <h2 className="card__title">Technology</h2>
          <dl className="detail-list">
            <Row label="Platform" value={show(app.platform)} />
            <Row label="Frontend" value={show(app.frontendTechnology)} />
            <Row label="Backend" value={show(app.backendTechnology)} />
            <Row label="Database" value={show(app.databaseTechnology)} />
            <Row label="Authentication" value={show(app.authenticationTechnology)} />
          </dl>
        </div>

        <div className="card">
          <h2 className="card__title">Repository & deployment</h2>
          <dl className="detail-list">
            <Row label="Repository" value={show(app.repositoryUrl)} />
            <Row label="Production URL" value={show(app.productionUrl)} />
            <Row label="Staging URL" value={show(app.stagingUrl)} />
            <Row label="Environment" value={app.environment} />
            <Row label="Version" value={show(app.version)} />
          </dl>
        </div>

        <div className="card">
          <h2 className="card__title">Integration & status</h2>
          <dl className="detail-list">
            <Row label="Integration type" value={app.integrationType} />
            <Row label="Adapter type" value={show(app.adapterType)} />
            <Row label="Integration status" value={app.integrationStatus} />
            <Row label="Lifecycle status" value={app.status} />
            <Row label="Health check enabled" value={app.healthCheckEnabled ? 'Yes' : 'No'} />
          </dl>
        </div>
      </div>
    </section>
  );
}
