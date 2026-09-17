import { Link } from 'react-router-dom';

export function Forbidden({ requiredPermission }: { requiredPermission?: string }) {
  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">Access denied</h1>
        <span className="badge badge--down">403</span>
      </header>
      <div className="card card--placeholder">
        <p>You do not have permission to view this section.</p>
        {requiredPermission && (
          <p className="muted">
            Required permission: <code>{requiredPermission}</code>
          </p>
        )}
        <Link className="btn" to="/">
          Back to dashboard
        </Link>
      </div>
    </section>
  );
}
