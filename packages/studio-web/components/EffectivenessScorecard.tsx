'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { formatMoneyCompact, formatMoneyRange } from '@/lib/format'

type Effectiveness = {
  feature_id: number
  title: string
  product_class: string
  owner_name?: string | null
  sizing_accuracy?: {
    value_status: 'on_track' | 'watch' | 're_estimate' | null
    calibration_error_pct: number | null
    realized_value_eur: number | null
    committed_value_low: number | null
    committed_value_high: number | null
  }
  delivery_health?: {
    story_count: number
    has_implementation: boolean
    qa_passed: boolean
    cycle_stage: string | null
    loop_closed: boolean
  }
  hypotheses?: Array<{
    kpi: string
    direction?: string
    magnitude_pct?: number
    verdict?: string | null
  }>
}

const STATUS_CHIP: Record<string, string> = {
  on_track: 'bg-ok-bg text-ok border-ok-bd',
  watch: 'bg-amber-bg text-amber border-amber-bd',
  re_estimate: 'bg-pink-bg text-pink border-pink-bd',
}

export default function EffectivenessScorecard({ featureId }: { featureId: string }) {
  const [data, setData] = useState<Effectiveness | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/features/${featureId}/effectiveness`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [featureId])

  if (loading) {
    return (
      <div className="mb-6 rounded-xl3 border border-line bg-white p-5 animate-pulse h-32" />
    )
  }
  if (!data) return null

  const sizing = data.sizing_accuracy
  const delivery = data.delivery_health
  const valueStatus = sizing?.value_status

  return (
    <section className="mb-6 rounded-xl3 border border-line bg-white overflow-hidden">
      <div className="px-5 py-3 border-b border-line bg-surface-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-bosch-muted">
            Product owner · Effectiveness
          </div>
          <div className="text-sm font-extrabold text-ink-1">
            {data.product_class}
            {data.owner_name ? ` · ${data.owner_name}` : ''}
          </div>
        </div>
        {valueStatus && (
          <span
            className={`text-[10px] font-bold uppercase tracking-wide border rounded-full px-2.5 py-1 ${STATUS_CHIP[valueStatus] ?? STATUS_CHIP.watch}`}
          >
            Sizing {valueStatus.replace('_', ' ')}
          </span>
        )}
      </div>
      <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-2">
            Sizing accuracy
          </div>
          <ul className="text-[13px] text-ink-2 space-y-1.5">
            <li>
              Value committed:{' '}
              {sizing?.committed_value_low != null && sizing?.committed_value_high != null
                ? formatMoneyRange(
                    sizing.committed_value_low,
                    sizing.committed_value_high,
                    'EUR',
                    'year',
                  )
                : '—'}
            </li>
            <li>
              Realized:{' '}
              {sizing?.realized_value_eur != null
                ? formatMoneyCompact(sizing.realized_value_eur, 'EUR')
                : 'Pending Learn'}
            </li>
            <li>
              Calibration error:{' '}
              {sizing?.calibration_error_pct != null
                ? `${sizing.calibration_error_pct.toFixed(1)}%`
                : '—'}
            </li>
          </ul>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-2">
            Delivery health
          </div>
          <ul className="text-[13px] text-ink-2 space-y-1.5">
            <li>{delivery?.story_count ?? 0} user stories with criteria</li>
            <li>{delivery?.has_implementation ? '✓' : '○'} Implementation recorded</li>
            <li>{delivery?.qa_passed ? '✓' : '○'} Quality gate passed</li>
            <li>
              Cycle: {delivery?.cycle_stage ?? '—'}
              {delivery?.loop_closed ? ' · loop closed' : ''}
            </li>
          </ul>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-2">
            Hypothesis outcomes
          </div>
          {!data.hypotheses?.length ? (
            <p className="text-[13px] text-ink-3">No hypotheses linked yet.</p>
          ) : (
            <ul className="text-[13px] text-ink-2 space-y-1.5">
              {data.hypotheses.slice(0, 3).map((h) => (
                <li key={h.kpi}>
                  <span className="font-semibold text-ink-1">{String(h.kpi)}</span>
                  {h.magnitude_pct != null ? ` ${h.direction === 'decrease' ? '↓' : '↑'}${h.magnitude_pct}%` : ''}
                  {h.verdict ? ` — ${h.verdict.slice(0, 60)}…` : ''}
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/outcomes/${featureId}`}
            className="inline-block mt-2 text-xs font-bold text-bosch-red hover:underline"
          >
            Judge outcomes →
          </Link>
        </div>
      </div>
    </section>
  )
}
