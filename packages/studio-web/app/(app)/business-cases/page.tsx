'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { formatMoneyCompact } from '@/lib/format'

type StatusKey =
  | 'needs_review'
  | 'draft'
  | 'sizing'
  | 'awaiting_decision'
  | 'admitted'
  | 'deferred'
  | 'rejected'

type BusinessCaseRow = {
  feature_id: number
  title: string
  status: string
  status_key: StatusKey
  pain_point_count: number
  value_low?: number | null
  value_high?: number | null
  value_currency?: string | null
  effort_low?: number | null
  effort_high?: number | null
  top_segment?: string | null
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'needs_review', label: 'Needs your review' },
  { key: 'sizing', label: 'Being sized' },
  { key: 'awaiting_decision', label: 'Awaiting decision' },
  { key: 'admitted', label: 'Admitted' },
] as const

const STATUS_CHIP: Record<StatusKey, string> = {
  needs_review: 'bg-amber-bg text-amber border-amber-bd',
  draft: 'bg-surface-1 text-ink-2 border-line',
  sizing: 'bg-blue-bg text-blue border-blue-bd',
  awaiting_decision: 'bg-amber-bg text-amber border-amber-bd',
  admitted: 'bg-ok-bg text-ok border-ok-bd',
  deferred: 'bg-surface-1 text-ink-2 border-line',
  rejected: 'bg-pink-bg text-pink border-pink-bd',
}

const STATUS_ACCENT: Record<StatusKey, string> = {
  needs_review: 'bg-amber',
  draft: 'bg-bosch-red',
  sizing: 'bg-blue',
  awaiting_decision: 'bg-amber',
  admitted: 'bg-ok',
  deferred: 'bg-ink-3',
  rejected: 'bg-pink',
}

export default function BusinessCasesPage() {
  const [rows, setRows] = useState<BusinessCaseRow[]>([])
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('filter') as
      | (typeof FILTERS)[number]['key']
      | null
    if (fromUrl && FILTERS.some((f) => f.key === fromUrl)) setFilter(fromUrl)
  }, [])

  useEffect(() => {
    fetch('/api/business-cases')
      .then((r) => r.json())
      .then((data: BusinessCaseRow[]) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  const visible = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.status_key === filter)),
    [rows, filter],
  )

  return (
    <>
      <div className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-bosch-muted mb-1">
          Decide
        </p>
        <h1 className="text-[22px] font-extrabold tracking-tight mb-1">Business Cases</h1>
        <p className="text-ink-3 text-[13.5px]">
          Turn customer problems into structured cases ready for value and effort sizing.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`text-[11px] font-bold uppercase tracking-wide rounded-full px-3 py-1.5 border ${
              filter === f.key
                ? 'bg-bosch-red text-white border-bosch-red'
                : 'bg-white text-ink-2 border-line hover:border-bosch-red'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white border border-line rounded-xl3 h-[88px] animate-pulse"
            />
          ))}
        </div>
      ) : !visible.length ? (
        <div className="bg-white border border-line rounded-xl3 px-6 py-12 text-center">
          <p className="text-ink-2 text-sm font-semibold mb-2">
            {filter === 'all'
              ? 'No business cases yet. Head to Pain Points to start one.'
              : `No cases with status “${FILTERS.find((f) => f.key === filter)?.label ?? filter}”.`}
          </p>
          {filter === 'all' && (
            <Link
              href="/pain-points"
              className="inline-block mt-2 rounded-xl2 px-4 py-2 text-xs font-bold bg-bosch-red text-white"
            >
              Go to Pain Points →
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((item) => {
            const key = item.status_key ?? 'draft'
            const hasValue =
              item.value_low != null &&
              item.value_high != null &&
              Number.isFinite(item.value_low) &&
              Number.isFinite(item.value_high)
            const hasEffort =
              item.effort_low != null &&
              item.effort_high != null &&
              Number.isFinite(item.effort_low) &&
              Number.isFinite(item.effort_high)
            return (
              <div
                key={item.feature_id}
                className="bg-white border border-line rounded-xl3 overflow-hidden flex"
              >
                <div className={`w-1.5 ${STATUS_ACCENT[key] ?? 'bg-ink-3'}`} />
                <div className="flex-1 px-5 py-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-extrabold text-ink-1 mb-1.5">{item.title}</div>
                    <div className="flex flex-wrap gap-1.5">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 ${STATUS_CHIP[key] ?? STATUS_CHIP.draft}`}
                      >
                        {item.status}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-wide bg-surface-1 text-ink-2 border border-line rounded-full px-2 py-0.5">
                        {item.pain_point_count} pain point
                        {item.pain_point_count === 1 ? '' : 's'}
                      </span>
                      {item.top_segment && (
                        <span className="text-[10px] font-bold uppercase tracking-wide bg-blue-bg text-blue border border-blue-bd rounded-full px-2 py-0.5">
                          🎯 {item.top_segment}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-4 shrink-0">
                    <div className="text-right min-w-[100px]">
                      <div className="text-[16px] font-extrabold text-ink-1 leading-none">
                        {hasValue
                          ? `${formatMoneyCompact(item.value_low!, item.value_currency ?? 'EUR')}–${formatMoneyCompact(item.value_high!, item.value_currency ?? 'EUR')}`
                          : '—'}
                      </div>
                      <div className="text-[11px] text-ink-3 mt-1">
                        {hasValue ? 'estimated value / yr' : 'not yet sized'}
                      </div>
                    </div>
                    <div className="text-right min-w-[72px]">
                      <div className="text-[16px] font-extrabold text-ink-1 leading-none">
                        {hasEffort ? `${item.effort_low}–${item.effort_high}w` : '—'}
                      </div>
                      <div className="text-[11px] text-ink-3 mt-1">
                        {hasEffort ? 'effort' : 'not yet sized'}
                      </div>
                    </div>
                  </div>
                  <Link
                    href={
                      key === 'awaiting_decision'
                        ? `/portfolio/${item.feature_id}`
                        : `/business-cases/${item.feature_id}`
                    }
                    className="shrink-0 rounded-xl2 px-3.5 py-2 text-xs font-bold bg-bosch-red text-white"
                  >
                    {key === 'needs_review'
                      ? 'Review →'
                      : key === 'awaiting_decision'
                        ? 'Decide →'
                        : 'View case →'}
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
