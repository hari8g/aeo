export default function RecommendationBadge({
  recommendation,
}: {
  recommendation: 'ADMIT' | 'DEFER' | 'REJECT' | string
}) {
  const key = String(recommendation).toUpperCase() as 'ADMIT' | 'DEFER' | 'REJECT'
  const cfg = {
    ADMIT: { styles: 'bg-ok-bg text-ok border-ok-bd', label: 'Suggests: Admit' },
    DEFER: { styles: 'bg-amber-bg text-amber border-amber-bd', label: 'Suggests: Defer' },
    REJECT: { styles: 'bg-pink-bg text-pink border-pink-bd', label: 'Suggests: Reject' },
  }[key] ?? {
    styles: 'bg-surface-1 text-ink-2 border-line',
    label: `Suggests: ${recommendation}`,
  }

  return (
    <span
      className={`text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 ${cfg.styles}`}
      style={{ opacity: 0.85 }}
    >
      {cfg.label}
    </span>
  )
}
