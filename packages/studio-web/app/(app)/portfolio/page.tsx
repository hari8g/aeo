'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import RecommendationBadge from '@/components/RecommendationBadge'

type PortfolioRow = {
  feature_id: number
  title: string
  status: 'Needs assessments' | 'Ready to assemble' | 'Ready for review' | 'Decided'
  has_value: boolean
  has_effort: boolean
  has_gtm: boolean
  recommendation: string | null
  decision: string | null
}

const FILTERS = [
  'All',
  'Needs assessments',
  'Ready to assemble',
  'Ready for review',
  'Decided',
] as const

function statusAccent(status: PortfolioRow['status']) {
  if (status === 'Needs assessments') return 'bg-ink-3'
  if (status === 'Ready to assemble') return 'bg-amber'
  if (status === 'Ready for review') return 'bg-blue'
  return 'bg-ok'
}

function statusChip(status: PortfolioRow['status']) {
  if (status === 'Needs assessments') return 'bg-surface-1 text-ink-2 border-line'
  if (status === 'Ready to assemble') return 'bg-amber-bg text-amber border-amber-bd'
  if (status === 'Ready for review') return 'bg-blue-bg text-blue border-blue-bd'
  return 'bg-ok-bg text-ok border-ok-bd'
}

function ctaLabel(status: PortfolioRow['status']) {
  if (status === 'Needs assessments') return 'Open →'
  if (status === 'Ready to assemble') return 'Assemble →'
  if (status === 'Ready for review') return 'Review →'
  return 'View decision →'
}

export default function PortfolioBoardPage() {
  const [rows, setRows] = useState<PortfolioRow[]>([])
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/portfolio')
      .then((r) => r.json())
      .then((data: PortfolioRow[]) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  const visible = useMemo(
    () => (filter === 'All' ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  )

  return (
    <>
      <div className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-bosch-muted mb-1">
          Decide
        </p>
        <h1 className="text-[22px] font-extrabold tracking-tight mb-1">Portfolio Review</h1>
        <p className="text-ink-3 text-[13.5px]">
          One packet per case — value, effort, and go-to-market together — for Admit / Defer /
          Reject.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`text-[11px] font-bold uppercase tracking-wide rounded-full px-3 py-1.5 border ${
              filter === f
                ? 'bg-bosch-red text-white border-bosch-red'
                : 'bg-white text-ink-2 border-line hover:border-bosch-red'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white border border-line rounded-xl3 h-[88px] animate-pulse" />
          ))}
        </div>
      ) : !visible.length ? (
        <div className="bg-white border border-line rounded-xl3 px-6 py-12 text-center">
          <p className="text-ink-2 text-sm font-semibold mb-2">
            {filter === 'All'
              ? 'No cases ready for portfolio review yet. Finish value, effort, and go-to-market first.'
              : `No cases with status “${filter}”.`}
          </p>
          {filter === 'All' && (
            <Link
              href="/business-cases"
              className="inline-block mt-2 rounded-xl2 px-4 py-2 text-xs font-bold bg-bosch-red text-white"
            >
              Go to Business Cases →
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((item) => (
            <div
              key={item.feature_id}
              className="bg-white border border-line rounded-xl3 overflow-hidden flex"
            >
              <div className={`w-1.5 ${statusAccent(item.status)}`} />
              <div className="flex-1 px-5 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-extrabold text-ink-1 mb-1.5">{item.title}</div>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 ${statusChip(item.status)}`}
                    >
                      {item.status}
                    </span>
                    {item.recommendation && item.status === 'Ready for review' && (
                      <RecommendationBadge recommendation={item.recommendation} />
                    )}
                    {item.decision && (
                      <span className="text-[10px] font-bold uppercase tracking-wide bg-ok-bg text-ok border border-ok-bd rounded-full px-2 py-0.5">
                        {item.decision}
                      </span>
                    )}
                  </div>
                </div>
                <Link
                  href={`/portfolio/${item.feature_id}`}
                  className="shrink-0 rounded-xl2 px-3.5 py-2 text-xs font-bold bg-bosch-red text-white"
                >
                  {ctaLabel(item.status)}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
