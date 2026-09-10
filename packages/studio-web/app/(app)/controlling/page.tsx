'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { formatMoneyCompact, formatMoneyRange } from '@/lib/format'

type ProductClassRow = {
  product_class: string
  program_count: number
  admitted_count: number
  closed_count: number
  value_low: number
  value_high: number
  delivery_cost_low: number
  delivery_cost_high: number
  realized_value_eur: number
  avg_calibration_error_pct: number | null
  features: Array<{ feature_id: number; title: string; status: string; top_segment?: string | null }>
}

type Summary = {
  currency: string
  product_classes: ProductClassRow[]
  totals: {
    program_count: number
    value_low: number
    value_high: number
    delivery_cost_low: number
    delivery_cost_high: number
    realized_value_eur: number
  }
}

type CalibrationSummary = {
  agents: Array<{
    agent_id: string
    samples: number
    avg_error_pct: number
    trend: string
  }>
  total_samples: number
}

export default function ControllingPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [calibration, setCalibration] = useState<CalibrationSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/controlling/summary').then((r) => r.json()),
      fetch('/api/calibration/summary').then((r) => r.json()),
    ])
      .then(([s, c]) => {
        setSummary(s.product_classes ? s : null)
        setCalibration(c.agents ? c : null)
      })
      .catch(() => {
        setSummary(null)
        setCalibration(null)
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-bosch-muted mb-1">
            Controlling
          </p>
          <h1 className="text-[22px] font-extrabold tracking-tight mb-1">Portfolio by product class</h1>
          <p className="text-ink-3 text-[13.5px] max-w-2xl">
            Optimise MPS reporting across product lines — committed value, delivery investment,
            realized outcomes, and estimator calibration in one view.
          </p>
        </div>
        <a
          href="/api/controlling/export"
          className="shrink-0 rounded-xl2 px-4 py-2 text-xs font-bold bg-bosch-red text-white"
        >
          Export CSV →
        </a>
      </div>

      {loading ? (
        <div className="rounded-xl3 border border-line bg-white h-48 animate-pulse" />
      ) : !summary ? (
        <div className="rounded-xl3 border border-line bg-white px-6 py-12 text-center text-sm text-ink-3">
          Could not load controlling summary. Is Platform running on :7070?
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <div className="rounded-xl3 border border-line bg-white px-4 py-4">
              <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">
                Programs
              </div>
              <div className="text-2xl font-extrabold">{summary.totals.program_count}</div>
            </div>
            <div className="rounded-xl3 border border-line bg-white px-4 py-4">
              <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">
                Committed value / yr
              </div>
              <div className="text-lg font-extrabold tracking-tight">
                {formatMoneyRange(summary.totals.value_low, summary.totals.value_high, 'EUR', 'year')}
              </div>
            </div>
            <div className="rounded-xl3 border border-line bg-white px-4 py-4">
              <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">
                Delivery investment
              </div>
              <div className="text-lg font-extrabold tracking-tight">
                {formatMoneyRange(
                  summary.totals.delivery_cost_low,
                  summary.totals.delivery_cost_high,
                  'EUR',
                )}
              </div>
            </div>
            <div className="rounded-xl3 border border-line bg-white px-4 py-4">
              <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">
                Realized (Learn)
              </div>
              <div className="text-lg font-extrabold tracking-tight">
                {summary.totals.realized_value_eur > 0
                  ? formatMoneyCompact(summary.totals.realized_value_eur, 'EUR')
                  : '—'}
              </div>
            </div>
          </div>

          <div className="rounded-xl3 border border-line bg-white overflow-hidden mb-8">
            <div className="px-5 py-3 border-b border-line bg-surface-2">
              <h2 className="text-sm font-extrabold text-ink-1">By product class</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[10px] font-bold uppercase tracking-wide text-ink-3">
                    <th className="px-5 py-3">Class</th>
                    <th className="px-3 py-3">Programs</th>
                    <th className="px-3 py-3">Admitted</th>
                    <th className="px-3 py-3">Closed loops</th>
                    <th className="px-3 py-3">Value / yr</th>
                    <th className="px-3 py-3">Delivery</th>
                    <th className="px-3 py-3">Realized</th>
                    <th className="px-3 py-3">Avg cal. error</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.product_classes.map((row) => (
                    <tr key={row.product_class} className="border-b border-line last:border-0">
                      <td className="px-5 py-4 font-extrabold text-ink-1">{row.product_class}</td>
                      <td className="px-3 py-4">{row.program_count}</td>
                      <td className="px-3 py-4">{row.admitted_count}</td>
                      <td className="px-3 py-4">{row.closed_count}</td>
                      <td className="px-3 py-4 whitespace-nowrap">
                        {formatMoneyRange(row.value_low, row.value_high, 'EUR', 'year')}
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap">
                        {formatMoneyRange(row.delivery_cost_low, row.delivery_cost_high, 'EUR')}
                      </td>
                      <td className="px-3 py-4">
                        {row.realized_value_eur > 0
                          ? formatMoneyCompact(row.realized_value_eur, 'EUR')
                          : '—'}
                      </td>
                      <td className="px-3 py-4">
                        {row.avg_calibration_error_pct != null
                          ? `${row.avg_calibration_error_pct.toFixed(1)}%`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {summary.product_classes.map((pc) => (
            <div key={pc.product_class} className="mb-6">
              <h3 className="text-[15px] font-extrabold text-ink-1 mb-2">{pc.product_class} programs</h3>
              <div className="space-y-2">
                {pc.features.map((f) => (
                  <Link
                    key={f.feature_id}
                    href={`/business-cases/${f.feature_id}`}
                    className="block rounded-xl2 border border-line bg-white px-4 py-3 hover:border-bosch-red"
                  >
                    <div className="font-bold text-[13px] text-ink-1">{f.title}</div>
                    <div className="text-[11px] text-ink-3 mt-1">
                      {f.status}
                      {f.top_segment ? ` · ${f.top_segment}` : ''}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}

          {calibration && calibration.agents.length > 0 && (
            <div className="rounded-xl3 border border-line bg-white overflow-hidden">
              <div className="px-5 py-3 border-b border-line bg-surface-2">
                <h2 className="text-sm font-extrabold text-ink-1">Estimator calibration (org-wide)</h2>
              </div>
              <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                {calibration.agents.map((a) => (
                  <div key={a.agent_id} className="rounded-xl2 border border-line p-4">
                    <div className="text-xs font-extrabold text-ink-1">{a.agent_id}</div>
                    <div className="text-[13px] text-ink-2 mt-2">
                      {a.samples} sample{a.samples === 1 ? '' : 's'} · avg error{' '}
                      {a.avg_error_pct.toFixed(1)}% ·{' '}
                      <span className="capitalize">{a.trend}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
