import { formatMoneyCompact } from '@/lib/format'

function MetricPair({
  label,
  value,
  className = '',
  detail,
}: {
  label: string
  value: string
  className?: string
  detail?: string
}) {
  return (
    <div className={className}>
      <div className="text-ink-3">{label}</div>
      <div className="font-semibold text-ink-1">{value}</div>
      {detail && <p className="text-[11px] text-ink-3 mt-1 leading-snug">{detail}</p>}
    </div>
  )
}

export type Segment = {
  name: string
  size: string
  fit: string
  cac: string
  ltv: string
  description?: string
  cacLowEur?: number
  cacHighEur?: number
  cacNotes?: string
  ltvLowEur?: number
  ltvHighEur?: number
  ltvNotes?: string
  paybackMonthsLow?: number
  paybackMonthsHigh?: number
  paybackNotes?: string
  ltvCacRatio?: string
}

function eurRange(low?: number, high?: number): string | null {
  if (low == null || high == null || !Number.isFinite(low) || !Number.isFinite(high)) return null
  return `${formatMoneyCompact(low, 'EUR')} – ${formatMoneyCompact(high, 'EUR')}`
}

export default function SegmentCard({ segment }: { segment: Segment }) {
  const fitConfig: Record<string, { label: string; styles: string }> = {
    high: { label: 'Strong fit', styles: 'bg-ok-bg text-ok border-ok-bd' },
    medium: { label: 'Reasonable fit', styles: 'bg-amber-bg text-amber border-amber-bd' },
    low: { label: 'Uncertain fit', styles: 'bg-pink-bg text-pink border-pink-bd' },
  }
  const fit = fitConfig[segment.fit] ?? fitConfig.medium
  const cacRange = eurRange(segment.cacLowEur, segment.cacHighEur)
  const ltvRange = eurRange(segment.ltvLowEur, segment.ltvHighEur)
  const payback =
    segment.paybackMonthsLow != null && segment.paybackMonthsHigh != null
      ? `${segment.paybackMonthsLow}–${segment.paybackMonthsHigh} months`
      : null

  return (
    <div className="border border-line rounded-xl2 p-4 bg-white">
      <div className="flex items-start justify-between mb-2 gap-2">
        <div>
          <div className="font-bold text-[13.5px] text-ink-1">{segment.name}</div>
          {segment.description && (
            <p className="text-[12px] text-ink-3 mt-1 leading-snug">{segment.description}</p>
          )}
        </div>
        <span
          className={`shrink-0 text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 ${fit.styles}`}
        >
          {fit.label}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-[11.5px] mt-3">
        <MetricPair label="Segment size" value={segment.size} />
        <MetricPair
          label="LTV : CAC"
          value={segment.ltvCacRatio ?? '—'}
        />
        <MetricPair
          label="Cost to acquire (CAC)"
          value={cacRange ? `${cacRange}` : segment.cac}
          detail={segment.cacNotes}
          className="col-span-2"
        />
        <MetricPair
          label="Lifetime value (LTV)"
          value={ltvRange ? `${ltvRange}` : segment.ltv}
          detail={segment.ltvNotes}
          className="col-span-2"
        />
        <MetricPair
          label="Payback period"
          value={payback ?? '—'}
          detail={segment.paybackNotes}
          className="col-span-2"
        />
      </div>
    </div>
  )
}
