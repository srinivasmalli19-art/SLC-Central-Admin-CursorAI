interface ComingSoonProps {
  title: string;
}

/** Placeholder for modules that are not implemented in Phase 1. */
export function ComingSoon({ title }: ComingSoonProps) {
  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">{title}</h1>
        <span className="badge badge--muted">Coming in a later phase</span>
      </header>
      <div className="card card--placeholder">
        <p>
          The <strong>{title}</strong> module is part of the SLC Central Admin roadmap and
          is not implemented yet.
        </p>
        <p className="muted">
          This is a Phase 1 foundation placeholder. No data is shown here to avoid any
          confusion with real production information.
        </p>
      </div>
    </section>
  );
}
