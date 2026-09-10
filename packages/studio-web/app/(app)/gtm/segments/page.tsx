'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { formatMoneyRange } from '@/lib/format'

type SegmentRow = {
  name: string
  feature_count: number
  product_classes: string[]
  value_low: number
  value_high: number
  fit_high_count: number
}

export default function GtmSegmentsPage() {
  const [segments, setSegments] = useState<SegmentRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/gtm/segments')
      .then((r) => r.json())
      .then((d) => setSegments(Array.isArray(d.segments) ? d.segments : []))
      .catch(() => setSegments([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <>
      <div className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-bosch-muted mb-1">
          Decide · Go-to-market
        </p>
        <h1 className="text-[22px] font-extrabold tracking-tight mb-1">Segment portfolio</h1>
        <p className="text-ink-3 text-[13.5px] max-w-2xl">
          Roll up GTM segments across product classes — where committed value concentrates and which
          customer cohorts drive the portfolio.
        </p>
      </div>

      <div className="mb-4">
        <Link href="/gtm" className="text-xs font-bold text-bosch-red hover:underline">
          ← Per-program GTM detail
        </Link>
      </div>

      {loading ? (
        <div className="rounded-xl3 border border-line bg-white h-40 animate-pulse" />
      ) : !segments.length ? (
        <div className="rounded-xl3 border border-line bg-white px-6 py-12 text-center text-sm text-ink-3">
          No GTM segments found. Seed demo data or size GTM on business cases.
        </div>
      ) : (
        <div className="space-y-3">
          {segments.map((s) => (
            <div
              key={s.name}
              className="rounded-xl3 border border-line bg-white px-5 py-4 flex flex-wrap items-center gap-4"
            >
              <div className="flex-1 min-w-[200px]">
                <div className="text-[15px] font-extrabold text-ink-1">{s.name}</div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {s.product_classes.map((pc) => (
                    <span
                      key={pc}
                      className="text-[10px] font-bold uppercase tracking-wide bg-blue-bg text-blue border border-blue-bd rounded-full px-2 py-0.5"
                    >
                      {pc}
                    </span>
                  ))}
                  <span className="text-[10px] font-bold uppercase tracking-wide bg-surface-1 text-ink-2 border border-line rounded-full px-2 py-0.5">
                    {s.feature_count} program{s.feature_count === 1 ? '' : 's'}
                  </span>
                  {s.fit_high_count > 0 && (
                    <span className="text-[10px] font-bold uppercase tracking-wide bg-ok-bg text-ok border border-ok-bd rounded-full px-2 py-0.5">
                      high fit ×{s.fit_high_count}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[16px] font-extrabold text-ink-1">
                  {formatMoneyRange(s.value_low, s.value_high, 'EUR', 'year')}
                </div>
                <div className="text-[11px] text-ink-3 mt-1">attributable value band</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
