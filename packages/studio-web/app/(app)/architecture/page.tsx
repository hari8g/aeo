'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type ArchRow = {
  feature_id: number
  title: string
  status: 'Needs architecture' | 'Architecture proposed'
  context_count: number
  story_count: number
}

const FILTERS = ['All', 'Needs architecture', 'Architecture proposed'] as const

function statusAccent(status: ArchRow['status']) {
  if (status === 'Needs architecture') return 'bg-amber'
  return 'bg-ok'
}

function statusChip(status: ArchRow['status']) {
  if (status === 'Needs architecture') return 'bg-amber-bg text-amber border-amber-bd'
  return 'bg-ok-bg text-ok border-ok-bd'
}

export default function ArchitectureBoardPage() {
  const [rows, setRows] = useState<ArchRow[]>([])
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/architecture')
      .then((r) => r.json())
      .then((data: ArchRow[]) => setRows(Array.isArray(data) ? data : []))
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
          Define
        </p>
        <h1 className="text-[22px] font-extrabold tracking-tight mb-1">Architecture</h1>
        <p className="text-ink-3 text-[13.5px]">
          Bounded contexts and service interfaces for admitted cases — how we&apos;ll structure
          the build.
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
          {[1, 2].map((i) => (
            <div key={i} className="bg-white border border-line rounded-xl3 h-[88px] animate-pulse" />
          ))}
        </div>
      ) : !visible.length ? (
        <div className="bg-white border border-line rounded-xl3 px-6 py-12 text-center">
          <p className="text-ink-2 text-sm font-semibold mb-2">
            {filter === 'All'
              ? 'No admitted cases yet. Admit a case, draft requirements, then propose architecture.'
              : `No cases with status “${filter}”.`}
          </p>
          {filter === 'All' && (
            <Link
              href="/requirements"
              className="inline-block mt-2 rounded-xl2 px-4 py-2 text-xs font-bold bg-bosch-red text-white"
            >
              Go to Requirements →
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
                    {item.context_count > 0 && (
                      <span className="text-[10px] font-bold uppercase tracking-wide bg-surface-1 text-ink-2 border border-line rounded-full px-2 py-0.5">
                        {item.context_count} context{item.context_count === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                </div>
                <Link
                  href={`/architecture/${item.feature_id}`}
                  className="shrink-0 rounded-xl2 px-3.5 py-2 text-xs font-bold bg-bosch-red text-white"
                >
                  {item.status === 'Needs architecture' ? 'Propose architecture →' : 'View architecture →'}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
