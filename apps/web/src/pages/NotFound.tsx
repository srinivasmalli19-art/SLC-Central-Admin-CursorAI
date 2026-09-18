import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">Page not found</h1>
      </header>
      <div className="card card--placeholder">
        <p>The page you are looking for does not exist.</p>
        <Link className="btn" to="/">
          Back to dashboard
        </Link>
      </div>
    </section>
  );
}
