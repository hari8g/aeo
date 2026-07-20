type Hypothesis = {
  kpi: string
  direction: 'increase' | 'decrease' | string
  magnitudePct: number
  timeframeDays: number
  attributionMethod: string
  rationale?: string
}

function prettifyKpiName(kpi: string): string {
  return kpi.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function attributionLabel(method: string): string {
  const map: Record<string, string> = {
    before_after: 'before and after',
    ab_test: 'an A/B test',
    synthetic_control: 'a synthetic control',
  }
  return map[method] ?? method.replace(/_/g, ' ')
}

export default function BetCard({ hypothesis }: { hypothesis: Hypothesis }) {
  const verb = hypothesis.direction === 'decrease' ? 'Cut' : 'Grow'
  return (
    <div className="border border-line rounded-xl2 px-4 py-3 flex items-center justify-between gap-3 bg-white">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-ink-1">
          {verb}{' '}
          <span className="font-mono text-[12px] bg-surface-2 px-1.5 py-0.5 rounded">
            {prettifyKpiName(hypothesis.kpi)}
          </span>{' '}
          by {hypothesis.magnitudePct}%
        </div>
        <div className="text-[11.5px] text-ink-3 mt-0.5">
          Within {hypothesis.timeframeDays} days · we&apos;ll compare{' '}
          {attributionLabel(hypothesis.attributionMethod)}
        </div>
      </div>
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide bg-blue-bg text-blue border border-blue-bd rounded-full px-2 py-0.5">
        Not yet locked in
      </span>
    </div>
  )
}
