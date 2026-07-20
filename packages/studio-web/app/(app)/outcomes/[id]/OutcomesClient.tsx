'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type Detail = {
  feature_id: number
  title: string
  admitted: boolean
  has_metrics: boolean
  status: string
  verdict: { id: number; title: string; summary: string } | null
  outcomes: Array<{ id: number; label: string; kpi: unknown; value: unknown }>
  observations: Array<{ id: number; label: string; sli: unknown }>
}

export default function OutcomesClient({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [judging, setJudging] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/outcomes/${id}`)
      const body = (await res.json()) as Detail & { error?: string }
      if (!res.ok) throw new Error(body.error || 'Could not load')
      setDetail(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load')
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function judgeOutcomes() {
    setJudging(true)
    setError('')
    try {
      const res = await fetch(`/api/outcomes/${id}/judge`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Could not judge outcomes')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not judge outcomes')
    } finally {
      setJudging(false)
    }
  }

  if (loading || judging) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8">
        <p className="text-sm font-semibold text-ink-2 mb-1">
          {judging ? 'Judging outcomes…' : 'Loading…'}
        </p>
        <p className="text-[13px] text-ink-3">Comparing live metrics to the original hypothesis.</p>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-ink-2">{error || 'Case not found'}</p>
        <Link href="/outcomes" className="inline-block mt-3 text-xs font-bold text-bosch-red">
          ← Back to Outcomes
        </Link>
      </div>
    )
  }

  if (!detail.admitted) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Not admitted yet</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Outcomes are judged only after Portfolio Review admits the case.
        </p>
        <Link
          href={`/portfolio/${id}`}
          className="inline-block rounded-xl2 px-4 py-2 text-xs font-bold bg-bosch-red text-white"
        >
          Open Portfolio Review →
        </Link>
      </div>
    )
  }

  if (!detail.has_metrics) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Live metrics first</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Check rollout health so we have live metrics before judging outcomes.
        </p>
        <Link
          href={`/rollout/${id}`}
          className="inline-block rounded-xl2 px-4 py-2 text-xs font-bold bg-bosch-red text-white"
        >
          Open Rollout →
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl2 border border-pink-bd bg-pink-bg text-pink px-4 py-3 text-sm font-semibold">
          {error}
        </div>
      )}

      {!detail.verdict ? (
        <div className="bg-white border border-line rounded-xl3 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-ink-2 mb-1">Outcomes not judged yet</p>
          <p className="text-[13px] text-ink-3 mb-5 max-w-md mx-auto">
            Compare live metrics to the hypothesis and record the verdict.
          </p>
          {canEdit ? (
            <button
              type="button"
              onClick={() => void judgeOutcomes()}
              className="rounded-xl2 px-4 py-2.5 text-sm font-bold bg-bosch-red text-white"
            >
              Judge the outcomes
            </button>
          ) : (
            <p className="text-[12px] text-ink-3">Only editors can judge outcomes.</p>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[12px] font-bold text-ok">{detail.status}</div>
            {canEdit && (
              <button
                type="button"
                onClick={() => void judgeOutcomes()}
                className="rounded-xl2 px-3 py-1.5 text-xs font-bold border border-line text-ink-2 hover:border-bosch-red"
              >
                Judge again
              </button>
            )}
          </div>

          <div className="bg-white border border-line rounded-xl3 px-5 py-4">
            <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">
              Verdict
            </div>
            <h2 className="text-[15px] font-extrabold text-ink-1 mb-2">{detail.verdict.title}</h2>
            {detail.verdict.summary ? (
              <p className="text-[13px] text-ink-2 leading-relaxed">{detail.verdict.summary}</p>
            ) : null}
          </div>

          {detail.outcomes.length > 0 && (
            <div className="bg-white border border-line rounded-xl3 overflow-hidden">
              <div className="px-5 py-3 border-b border-line">
                <h2 className="text-[13px] font-extrabold text-ink-1">Realized outcomes</h2>
              </div>
              <ul className="divide-y divide-line">
                {detail.outcomes.map((o) => (
                  <li key={o.id} className="px-5 py-3">
                    <div className="text-[13px] font-semibold text-ink-1">{o.label}</div>
                    <div className="text-[11px] text-ink-3">
                      {o.kpi != null ? String(o.kpi) : 'KPI'}
                      {o.value != null ? ` · ${String(o.value)}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {detail.observations.length > 0 && (
            <div className="bg-white border border-line rounded-xl3 overflow-hidden">
              <div className="px-5 py-3 border-b border-line">
                <h2 className="text-[13px] font-extrabold text-ink-1">Metrics used</h2>
              </div>
              <ul className="divide-y divide-line">
                {detail.observations.map((o) => (
                  <li key={o.id} className="px-5 py-3 flex justify-between gap-3 text-[13px]">
                    <span className="font-semibold text-ink-1">{o.label}</span>
                    <span className="text-ink-3">{String(o.sli ?? '—')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
