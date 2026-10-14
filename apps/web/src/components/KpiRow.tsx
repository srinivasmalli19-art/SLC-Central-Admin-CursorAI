/** A row of headline numbers for an app page. */
export function KpiRow({ items }: { items: { label: string; value: number; tone?: 'warn' }[] }) {
  return (
    <dl className="kpi-row">
      {items.map((item) => (
        <div key={item.label} className={`card kpi ${item.tone === 'warn' && item.value > 0 ? 'kpi--warn' : ''}`}>
          <dt className="kpi__label">{item.label}</dt>
          <dd className="kpi__value">{item.value.toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
}
