'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type Detail = {
  feature_id: number
  title: string
  admitted: boolean
  has_verdict: boolean
  status: string
  assessment: { id: number; title: string; summary: string } | null
  sentiments: Array<{
    id: number
    stakeholder: string
    sentiment: string
    text: string
  }>
}

function sentimentChip(sentiment: string) {
  const s = sentiment.toLowerCase()
  if (s === 'positive' || s === 'good') return 'bg-ok-bg text-ok border-ok-bd'
  if (s === 'negative' || s === 'bad') return 'bg-pink-bg text-pink border-pink-bd'
  return 'bg-amber-bg text-amber border-amber-bd'
}

export default function ImpactClient({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [assessing, setAssessing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/impact/${id}`)
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

  async function assessImpact() {
    setAssessing(true)
    setError('')
    try {
      const res = await fetch(`/api/impact/${id}/assess`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Could not assess impact')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not assess impact')
    } finally {
      setAssessing(false)
    }
  }

  if (loading || assessing) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8">
        <p className="text-sm font-semibold text-ink-2 mb-1">
          {assessing ? 'Assessing impact…' : 'Loading…'}
        </p>
        <p className="text-[13px] text-ink-3">Gathering stakeholder sentiment for this case.</p>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-ink-2">{error || 'Case not found'}</p>
        <Link href="/impact" className="inline-block mt-3 text-xs font-bold text-bosch-red">
          ← Back to Impact
        </Link>
      </div>
    )
  }

  if (!detail.admitted) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Not admitted yet</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Impact is assessed only after Portfolio Review admits the case.
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

  if (!detail.has_verdict) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Outcomes first</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Judge the outcomes before assessing stakeholder impact.
        </p>
        <Link
          href={`/outcomes/${id}`}
          className="inline-block rounded-xl2 px-4 py-2 text-xs font-bold bg-bosch-red text-white"
        >
          Open Outcomes →
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

      {!detail.assessment ? (
        <div className="bg-white border border-line rounded-xl3 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-ink-2 mb-1">No impact assessment yet</p>
          <p className="text-[13px] text-ink-3 mb-5 max-w-md mx-auto">
            Capture how customers and internal stakeholders experienced the change.
          </p>
          {canEdit ? (
            <button
              type="button"
              onClick={() => void assessImpact()}
              className="rounded-xl2 px-4 py-2.5 text-sm font-bold bg-bosch-red text-white"
            >
              Assess impact
            </button>
          ) : (
            <p className="text-[12px] text-ink-3">Only editors can assess impact.</p>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[12px] font-bold text-ok">{detail.status}</div>
            {canEdit && (
              <button
                type="button"
                onClick={() => void assessImpact()}
                className="rounded-xl2 px-3 py-1.5 text-xs font-bold border border-line text-ink-2 hover:border-bosch-red"
              >
                Assess again
              </button>
            )}
          </div>

          <div className="bg-white border border-line rounded-xl3 px-5 py-4">
            <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">
              Assessment
            </div>
            <h2 className="text-[15px] font-extrabold text-ink-1 mb-2">
              {detail.assessment.title}
            </h2>
            {detail.assessment.summary ? (
              <p className="text-[13px] text-ink-2 leading-relaxed">{detail.assessment.summary}</p>
            ) : null}
          </div>

          {detail.sentiments.length > 0 && (
            <div className="space-y-3">
              {detail.sentiments.map((s) => (
                <div
                  key={s.id}
                  className="bg-white border border-line rounded-xl3 px-5 py-4"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="text-[14px] font-extrabold text-ink-1">{s.stakeholder}</div>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 ${sentimentChip(String(s.sentiment))}`}
                    >
                      {String(s.sentiment)}
                    </span>
                  </div>
                  {s.text ? (
                    <p className="text-[13px] text-ink-2 leading-relaxed">{s.text}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
