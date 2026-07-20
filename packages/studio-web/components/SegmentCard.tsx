function MetricPair({
  label,
  value,
  className = '',
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={className}>
      <div className="text-ink-3">{label}</div>
      <div className="font-semibold text-ink-1 capitalize">{value}</div>
    </div>
  )
}

type Segment = {
  name: string
  size: string
  fit: string
  cac: string
  ltv: string
}

export default function SegmentCard({ segment }: { segment: Segment }) {
  const fitConfig: Record<string, { label: string; styles: string }> = {
    high: { label: 'Strong fit', styles: 'bg-ok-bg text-ok border-ok-bd' },
    medium: { label: 'Reasonable fit', styles: 'bg-amber-bg text-amber border-amber-bd' },
    low: { label: 'Uncertain fit', styles: 'bg-pink-bg text-pink border-pink-bd' },
  }
  const fit = fitConfig[segment.fit] ?? fitConfig.medium

  return (
    <div className="border border-line rounded-xl2 p-4 bg-white">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="font-bold text-[13.5px] text-ink-1">{segment.name}</div>
        <span
          className={`shrink-0 text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 ${fit.styles}`}
        >
          {fit.label}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11.5px]">
        <MetricPair label="Segment size" value={segment.size} />
        <MetricPair label="Cost to acquire (CAC)" value={segment.cac} />
        <MetricPair label="Lifetime value (LTV)" value={segment.ltv} className="col-span-2" />
      </div>
    </div>
  )
}
