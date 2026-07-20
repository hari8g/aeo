'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type GtmRow = {
  feature_id: number
  title: string
  status: 'Needs value first' | 'Ready to plan' | 'Planned'
  has_value: boolean
  top_segment: string | null
}

const FILTERS = ['All', 'Needs value first', 'Ready to plan', 'Planned'] as const

function statusAccent(status: GtmRow['status']) {
  if (status === 'Needs value first') return 'bg-ink-3'
  if (status === 'Ready to plan') return 'bg-amber'
  return 'bg-ok'
}

function statusChip(status: GtmRow['status']) {
  if (status === 'Needs value first')
    return 'bg-surface-1 text-ink-2 border-line'
  if (status === 'Ready to plan') return 'bg-amber-bg text-amber border-amber-bd'
  return 'bg-ok-bg text-ok border-ok-bd'
}

export default function GtmBoardPage() {
  const [rows, setRows] = useState<GtmRow[]>([])
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/gtm')
      .then((r) => r.json())
      .then((data: GtmRow[]) => setRows(Array.isArray(data) ? data : []))
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
        <h1 className="text-[22px] font-extrabold tracking-tight mb-1">Go-to-Market</h1>
        <p className="text-ink-3 text-[13.5px]">
          Who each case is for, how we&apos;d position it, and whether it&apos;s an easy sell —
          after business value is sized.
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
              ? 'No cases ready for go-to-market yet. Send a business case for sizing and estimate value first.'
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
                  <div className="flex flex-wrap gap-1.5">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 ${statusChip(item.status)}`}
                    >
                      {item.status}
                    </span>
                    {item.top_segment && (
                      <span className="text-[10px] font-bold uppercase tracking-wide bg-blue-bg text-blue border border-blue-bd rounded-full px-2 py-0.5">
                        🎯 {item.top_segment}
                      </span>
                    )}
                  </div>
                </div>
                <Link
                  href={`/gtm/${item.feature_id}`}
                  className="shrink-0 rounded-xl2 px-3.5 py-2 text-xs font-bold bg-bosch-red text-white"
                >
                  {item.status === 'Needs value first'
                    ? 'Open →'
                    : item.status === 'Ready to plan'
                      ? 'Plan GTM →'
                      : 'View plan →'}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
