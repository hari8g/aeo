'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type PainPoint = {
  id: number
  label: string
  metadata: {
    signalCount?: number
    cohorts?: string[]
    tags?: string[]
    workStatus?: string
    cycleId?: string
    importanceScore?: number
    trend?: string
  }
  signal_count: number
  recent_signal_count: number
  updated_at: string
}

function trendFor(pp: PainPoint): { label: string; accent: 'pink' | 'blue' | 'grey' } {
  const metaTrend = pp.metadata?.trend
  if (metaTrend === 'growing') return { label: 'Growing fast', accent: 'pink' }
  if (metaTrend === 'quiet') return { label: 'Quiet lately', accent: 'grey' }
  if (metaTrend === 'steady') return { label: 'Steady', accent: 'blue' }

  const total = pp.signal_count || Number(pp.metadata?.signalCount ?? 0) || 1
  const recent = Number(pp.recent_signal_count ?? 0)
  const daysSince = (Date.now() - new Date(pp.updated_at).getTime()) / (1000 * 60 * 60 * 24)
  if (daysSince >= 21 && recent === 0) return { label: 'Quiet lately', accent: 'grey' }
  if (recent > total * 0.2) return { label: 'Growing fast', accent: 'pink' }
  return { label: 'Steady', accent: 'blue' }
}

export default function PainPointsPage() {
  const [rows, setRows] = useState<PainPoint[]>([])

  useEffect(() => {
    fetch('/api/pain-points')
      .then((r) => r.json())
      .then((data: PainPoint[]) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]))
  }, [])

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[22px] font-extrabold tracking-tight mb-1">Pain Points</h1>
        <p className="text-ink-3 text-[13.5px]">
          Problems customers keep mentioning, sized by how many people are affected.
        </p>
      </div>

      <div className="space-y-3">
        {rows.map((pp, idx) => {
          const trend = trendFor(pp)
          const customers = pp.signal_count || Number(pp.metadata?.signalCount ?? 0)
          const cohorts = [
            ...(pp.metadata?.tags ?? []).slice(0, 2),
            ...(pp.metadata?.cohorts ?? []),
          ].filter((v, i, a) => a.indexOf(v) === i)
          const inProgress = pp.metadata?.workStatus === 'in_progress'
          const accent =
            trend.accent === 'pink'
              ? 'bg-pink'
              : trend.accent === 'blue'
                ? 'bg-blue'
                : 'bg-ink-3'

          return (
            <div
              key={pp.id}
              className="bg-white border border-line rounded-xl3 overflow-hidden flex"
            >
              <div className={`w-1.5 ${accent}`} />
              <div className="flex-1 px-5 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-extrabold text-ink-1 mb-1.5">{pp.label}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {idx === 0 && (
                      <span className="text-[10px] font-bold uppercase tracking-wide bg-pink-bg text-pink border border-pink-bd rounded-full px-2 py-0.5">
                        Top priority
                      </span>
                    )}
                    <span className="text-[10px] font-bold uppercase tracking-wide bg-surface-1 text-ink-2 border border-line rounded-full px-2 py-0.5">
                      {trend.label}
                    </span>
                    {cohorts.slice(0, 3).map((c) => (
                      <span
                        key={c}
                        className="text-[10px] font-bold uppercase tracking-wide bg-blue-bg text-blue border border-blue-bd rounded-full px-2 py-0.5"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[22px] font-extrabold text-ink-1 leading-none">{customers}</div>
                  <div className="text-[11px] text-ink-3 mt-1">customers affected</div>
                </div>
                <Link
                  href={`/business-cases/new?painPointId=${pp.id}&label=${encodeURIComponent(pp.label)}`}
                  className={`shrink-0 rounded-xl2 px-3.5 py-2 text-xs font-bold ${
                    inProgress
                      ? 'bg-surface-1 text-ink-2 border border-line'
                      : 'bg-bosch-red text-white'
                  }`}
                >
                  {inProgress ? 'Continue →' : 'Start working on this →'}
                </Link>
              </div>
            </div>
          )
        })}
        {!rows.length && (
          <div className="bg-white border border-line rounded-xl3 px-5 py-10 text-center text-ink-3 text-sm">
            No problems yet. Add feedback to get started.
          </div>
        )}
      </div>
    </>
  )
}
