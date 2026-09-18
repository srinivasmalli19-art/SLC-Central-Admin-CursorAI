type Tone = 'ok' | 'warn' | 'down' | 'muted';

interface StatusBadgeProps {
  tone: Tone;
  children: React.ReactNode;
}

export function StatusBadge({ tone, children }: StatusBadgeProps) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
