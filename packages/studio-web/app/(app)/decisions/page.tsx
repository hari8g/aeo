'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type DecisionRow = {
  id: number
  feature_id: number | null
  feature_title: string
  decision: string | null
  role: string | null
  rationale: string
  created_at: string
}

function DecisionIcon({ decision }: { decision: string | null }) {
  const d = (decision ?? '').toLowerCase()
  if (d === 'admit') return <span className="text-lg text-ok">✓</span>
  if (d === 'defer') return <span className="text-lg text-ink-3">↩</span>
  if (d === 'reject') return <span className="text-lg text-pink">✗</span>
  return <span className="text-lg text-ink-3">•</span>
}

function DecisionBadge({ decision }: { decision: string | null }) {
  const d = (decision ?? '').toLowerCase()
  const cfg =
    d === 'admit'
      ? { label: 'Admitted', styles: 'bg-ok-bg text-ok border-ok-bd' }
      : d === 'defer'
        ? { label: 'Deferred', styles: 'bg-surface-1 text-ink-2 border-line' }
        : d === 'reject'
          ? { label: 'Rejected', styles: 'bg-pink-bg text-pink border-pink-bd' }
          : { label: decision ?? 'Decision', styles: 'bg-surface-1 text-ink-2 border-line' }
  return (
    <span
      className={`text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 ${cfg.styles}`}
    >
      {cfg.label}
    </span>
  )
}

export default function DecisionHistoryPage() {
  const [rows, setRows] = useState<DecisionRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/decisions')
      .then((r) => r.json())
      .then((data: DecisionRow[]) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <>
      <div className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-bosch-muted mb-1">
          Decide
        </p>
        <h1 className="text-[22px] font-extrabold tracking-tight mb-1">Decision History</h1>
        <p className="text-ink-3 text-[13.5px]">
          Every portfolio decision ever recorded, and why — visible to everyone.
        </p>
      </div>

      <div className="bg-white border border-line rounded-xl3 overflow-hidden">
        <div className="px-5 py-3 border-b border-line">
          <h2 className="text-[15px] font-extrabold">Audit log</h2>
          <p className="text-[12px] text-ink-3">Newest first</p>
        </div>
        <div className="divide-y divide-line px-5">
          {loading ? (
            <div className="py-8 text-sm text-ink-3">Loading…</div>
          ) : !rows.length ? (
            <div className="py-10 text-center text-sm text-ink-3">
              No portfolio decisions yet. Admit, defer, or reject a case from Portfolio Review.
            </div>
          ) : (
            rows.map((d) => (
              <div key={d.id} className="py-4 flex gap-4">
                <div className="w-8 flex justify-center pt-0.5">
                  <DecisionIcon decision={d.decision} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {d.feature_id ? (
                      <Link
                        href={`/business-cases/${d.feature_id}`}
                        className="font-bold text-[13.5px] text-ink-1 hover:underline"
                      >
                        {d.feature_title}
                      </Link>
                    ) : (
                      <span className="font-bold text-[13.5px] text-ink-1">{d.feature_title}</span>
                    )}
                    <DecisionBadge decision={d.decision} />
                  </div>
                  {d.rationale ? (
                    <p className="text-[12.5px] text-ink-2 mb-1">&ldquo;{d.rationale}&rdquo;</p>
                  ) : null}
                  <p className="text-[11px] text-ink-3">
                    {d.role ?? 'Approver'} · {new Date(d.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}
