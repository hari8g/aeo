export default function ComplexityBadge({ level }: { level: 'low' | 'medium' | 'high' | string }) {
  const normalized = level === 'low' || level === 'high' ? level : 'medium'
  const cfg = {
    low: { label: 'Straightforward', styles: 'bg-ok-bg text-ok border-ok-bd' },
    medium: { label: 'Moderately complex', styles: 'bg-amber-bg text-amber border-amber-bd' },
    high: { label: 'Highly complex', styles: 'bg-pink-bg text-pink border-pink-bd' },
  }[normalized]

  return (
    <span
      className={`inline-block text-[10px] font-bold uppercase tracking-wide border rounded-full px-2.5 py-0.5 ${cfg.styles}`}
    >
      {cfg.label}
    </span>
  )
}
