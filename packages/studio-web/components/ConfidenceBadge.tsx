export default function ConfidenceBadge({ pct }: { pct: number }) {
  const safe = Number.isFinite(pct) ? Math.round(pct) : 0
  const tier = safe >= 70 ? 'ok' : safe >= 40 ? 'amber' : 'pink'
  const label =
    safe >= 70 ? 'Fairly confident' : safe >= 40 ? 'Somewhat confident' : 'Early guess'
  const styles =
    tier === 'ok'
      ? 'bg-ok-bg text-ok border-ok-bd'
      : tier === 'amber'
        ? 'bg-amber-bg text-amber border-amber-bd'
        : 'bg-pink-bg text-pink border-pink-bd'

  return (
    <span
      className={`inline-block mt-2 text-[10px] font-bold uppercase tracking-wide border rounded-full px-2.5 py-0.5 ${styles}`}
    >
      {label} ({safe}%)
    </span>
  )
}
