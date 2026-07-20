'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import ScoreGauge from '@/components/ScoreGauge'
import RecommendationBadge from '@/components/RecommendationBadge'
import SummaryChip from '@/components/SummaryChip'
import DecisionOption from '@/components/DecisionOption'
import ConfirmDialog from '@/components/ConfirmDialog'

type Hypothesis = {
  kpi: string
  direction: string
  magnitudePct: number
  timeframeDays: number
  committed?: boolean
}

type Segment = { name?: string; fit?: string }

type Detail = {
  feature_id: number
  title: string
  has_value: boolean
  has_effort: boolean
  has_gtm: boolean
  value: {
    valueLow?: number
    valueHigh?: number
    valueCurrency?: string
    hypotheses?: Hypothesis[]
  } | null
  effort: {
    effortWeeksLow?: number
    effortWeeksHigh?: number
  } | null
  gtm: {
    segments?: Segment[]
  } | null
  packet: {
    id: number
    data: {
      valueScore?: number
      riskScore?: number
      recommendation?: 'ADMIT' | 'DEFER' | 'REJECT'
      summary?: string
      decision?: string | null
    } | null
  } | null
  hypotheses: Hypothesis[]
  is_approver: boolean
  my_approver_titles: string[]
  approver_titles: string[]
  decision: {
    decision: string
    role: string
    rationale: string
    created_at: string
  } | null
}

function prettifyKpiName(kpi: string): string {
  return kpi.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function fitRank(fit?: string) {
  if (fit === 'high') return 3
  if (fit === 'medium') return 2
  if (fit === 'low') return 1
  return 0
}

function formatMoney(n: number, currency = 'INR') {
  const locale = currency === 'INR' ? 'en-IN' : currency === 'EUR' ? 'en-IE' : 'en-US'
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(n)
}

export default function PortfolioClient({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [assembling, setAssembling] = useState(false)
  const [error, setError] = useState('')
  const [decision, setDecision] = useState<'admit' | 'defer' | 'reject' | ''>('')
  const [rationale, setRationale] = useState('')
  const [approverTitle, setApproverTitle] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [justDecided, setJustDecided] = useState<'admit' | 'defer' | 'reject' | null>(null)

  const resultConfig = {
    admit: {
      icon: '🎉',
      bg: 'bg-ok-bg',
      title: 'This is moving forward',
      body: 'The bets are locked in. This now heads into Define, where the actual requirements and architecture get worked out.',
    },
    defer: {
      icon: '↩️',
      bg: 'bg-surface-1',
      title: 'Sent back to Listen',
      body: "This will show up again once there's more customer evidence to bring to a future review.",
    },
    reject: {
      icon: '📋',
      bg: 'bg-surface-1',
      title: 'Closed out',
      body: "This won't move forward, but the reasoning is saved — it'll help avoid re-proposing the same idea without new information.",
    },
  } as const

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/portfolio/${id}`)
      const body = (await res.json()) as Detail & { error?: string }
      if (!res.ok) throw new Error(body.error || 'Could not load')
      setDetail(body)
      if (body.my_approver_titles?.length) {
        setApproverTitle((prev) => prev || body.my_approver_titles[0]!)
      }
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

  async function assemblePacket() {
    setAssembling(true)
    setError('')
    try {
      const res = await fetch(`/api/portfolio/${id}/assemble`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Could not assemble packet')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not assemble packet')
    } finally {
      setAssembling(false)
    }
  }

  async function submitDecision() {
    if (!decision || rationale.trim().length < 10) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`/api/portfolio/${id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          role: approverTitle || detail?.my_approver_titles[0],
          rationale: rationale.trim(),
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Could not record decision')
      setShowConfirm(false)
      setJustDecided(decision)
      setDecision('')
      setRationale('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record decision')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading || assembling) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8">
        <p className="text-sm font-semibold text-ink-2 mb-1">
          {assembling ? 'Assembling the review packet…' : 'Loading…'}
        </p>
        <p className="text-[13px] text-ink-3">
          Pulling value, effort, and go-to-market into one place.
        </p>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-ink-2">{error || 'Case not found'}</p>
        <Link href="/portfolio" className="inline-block mt-3 text-xs font-bold text-bosch-red">
          ← Back to Portfolio Review
        </Link>
      </div>
    )
  }

  const { value, effort, gtm, packet } = detail
  const ready = detail.has_value && detail.has_effort && detail.has_gtm
  const packetData = packet?.data
  const topSegment =
    gtm?.segments
      ?.slice()
      .sort((a, b) => fitRank(b.fit) - fitRank(a.fit))[0]?.name ?? '—'
  const hyps = detail.hypotheses?.length
    ? detail.hypotheses
    : (value?.hypotheses ?? [])

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl2 border border-pink-bd bg-pink-bg text-pink px-4 py-3 text-sm font-semibold">
          {error}
        </div>
      )}

      {(!ready || !packet) && (
        <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-4">
          <div className="font-bold text-amber text-sm mb-2">
            {!ready ? 'Not ready for review yet' : 'Packet not assembled yet'}
          </div>
          {!ready ? (
            <ul className="text-[13px] text-ink-2 space-y-1">
              {!detail.has_value && (
                <li>
                  •{' '}
                  <Link href={`/business-cases/${id}/value`} className="underline font-semibold">
                    Business Value
                  </Link>{' '}
                  hasn&apos;t been estimated
                </li>
              )}
              {!detail.has_effort && (
                <li>
                  •{' '}
                  <Link href={`/business-cases/${id}/effort`} className="underline font-semibold">
                    Engineering Effort
                  </Link>{' '}
                  hasn&apos;t been estimated
                </li>
              )}
              {!detail.has_gtm && (
                <li>
                  •{' '}
                  <Link href={`/gtm/${id}`} className="underline font-semibold">
                    Go-to-Market
                  </Link>{' '}
                  hasn&apos;t been planned
                </li>
              )}
            </ul>
          ) : (
            <div className="text-center py-6">
              <button
                type="button"
                onClick={() => void assemblePacket()}
                className="rounded-xl2 px-4 py-2.5 text-sm font-bold bg-bosch-red text-white"
              >
                Assemble the packet for review
              </button>
            </div>
          )}
        </div>
      )}

      {packet && packetData && (
        <>
          <div className="bg-white border border-line rounded-xl3 overflow-hidden">
            <div className="px-5 py-3 border-b border-line">
              <h2 className="text-[15px] font-extrabold">The full picture</h2>
            </div>
            <div className="px-5 py-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <ScoreGauge label="Value" score={Number(packetData.valueScore ?? 0)} />
                <ScoreGauge
                  label="Risk"
                  score={Number(packetData.riskScore ?? 0)}
                  inverted
                />
              </div>

              <div className="p-4 bg-surface-1 rounded-xl2 mb-6">
                <div className="text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">
                  System&apos;s suggestion — not the decision
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <RecommendationBadge
                    recommendation={packetData.recommendation ?? 'DEFER'}
                  />
                  <span className="text-[12.5px] text-ink-2">{packetData.summary}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <SummaryChip
                  label="Estimated value"
                  value={
                    value?.valueLow != null && value?.valueHigh != null
                      ? `${formatMoney(value.valueLow, value.valueCurrency ?? 'EUR')}–${formatMoney(value.valueHigh, value.valueCurrency ?? 'EUR')}/yr`
                      : '—'
                  }
                />
                <SummaryChip
                  label="Estimated effort"
                  value={
                    effort?.effortWeeksLow != null && effort?.effortWeeksHigh != null
                      ? `${effort.effortWeeksLow}–${effort.effortWeeksHigh} weeks`
                      : '—'
                  }
                />
                <SummaryChip label="Best-fit segment" value={topSegment} />
              </div>
            </div>
          </div>

          <div className="bg-white border border-line rounded-xl3 overflow-hidden">
            <div className="px-5 py-3 border-b border-line">
              <h2 className="text-[15px] font-extrabold">Steering committee decision</h2>
            </div>
            <div className="px-5 py-5">
              {justDecided ? (
                <div className={`text-center py-10 rounded-xl2 ${resultConfig[justDecided].bg}`}>
                  <div className="text-4xl mb-3">{resultConfig[justDecided].icon}</div>
                  <h3 className="font-bold text-base mb-2">{resultConfig[justDecided].title}</h3>
                  <p className="text-ink-2 text-[13px] max-w-sm mx-auto">
                    {resultConfig[justDecided].body}
                  </p>
                  <Link
                    href="/decisions"
                    className="inline-block mt-4 text-xs font-bold text-bosch-red"
                  >
                    View in Decision History →
                  </Link>
                </div>
              ) : detail.decision ? (
                <div className="text-center py-4">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-ink-3 mb-2">
                    Decision recorded
                  </div>
                  <div className="text-lg font-extrabold text-ink-1 capitalize mb-1">
                    {detail.decision.decision}
                  </div>
                  <p className="text-[13px] text-ink-2 max-w-lg mx-auto mb-2">
                    {detail.decision.rationale}
                  </p>
                  <p className="text-[11px] text-ink-3">
                    As {detail.decision.role}
                    {detail.decision.created_at
                      ? ` · ${new Date(detail.decision.created_at).toLocaleString()}`
                      : ''}
                  </p>
                </div>
              ) : !detail.is_approver ? (
                <p className="text-[13px] text-ink-3 py-6 text-center">
                  Only designated approvers can record a decision here. You can review everything
                  above, but this action is reserved for{' '}
                  {detail.approver_titles.length
                    ? detail.approver_titles.join(', ')
                    : 'portfolio approvers'}
                  .
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
                    <DecisionOption
                      value="admit"
                      selected={decision === 'admit'}
                      onSelect={(v) => setDecision(v as 'admit')}
                      title="Admit"
                      tier="ok"
                      body="This becomes committed. Every bet in the value estimate locks in as a measured commitment before any code is written."
                    />
                    <DecisionOption
                      value="defer"
                      selected={decision === 'defer'}
                      onSelect={(v) => setDecision(v as 'defer')}
                      title="Not now"
                      tier="amber"
                      body="Goes back to Listen. More evidence can be gathered before this comes up again."
                    />
                    <DecisionOption
                      value="reject"
                      selected={decision === 'reject'}
                      onSelect={(v) => setDecision(v as 'reject')}
                      title="No"
                      tier="pink"
                      body="Closes this out. The reasoning is kept so we don't re-propose the same idea blind."
                    />
                  </div>

                  <label className="block mb-4">
                    <span className="text-[12.5px] font-bold block mb-1.5">
                      Your reasoning (required)
                    </span>
                    <textarea
                      className="w-full border border-line rounded-xl2 p-3 text-[13px]"
                      rows={3}
                      placeholder="Why this decision — this is permanently recorded."
                      value={rationale}
                      onChange={(e) => setRationale(e.target.value)}
                    />
                    {rationale.length > 0 && rationale.length < 10 && (
                      <span className="text-[11px] text-pink">
                        A few more words would help future reviewers understand this.
                      </span>
                    )}
                  </label>

                  <select
                    className="mb-4 w-full border border-line rounded-xl2 px-3 py-2 text-sm font-semibold"
                    value={approverTitle || detail.my_approver_titles[0] || ''}
                    onChange={(e) => setApproverTitle(e.target.value)}
                  >
                    {detail.my_approver_titles.map((t) => (
                      <option key={t} value={t}>
                        Deciding as: {t}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    className="w-full rounded-xl2 px-4 py-2.5 text-sm font-bold bg-bosch-red text-white disabled:opacity-40"
                    disabled={!decision || rationale.trim().length < 10}
                    onClick={() => setShowConfirm(true)}
                  >
                    Record this decision
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {showConfirm && decision === 'admit' && (
        <ConfirmDialog
          title="This locks in permanently"
          body={
            <>
              <p className="mb-3">
                Once you confirm, the following becomes permanent and cannot be edited:
              </p>
              <ul className="space-y-1.5 mb-3">
                {hyps.map((h, i) => (
                  <li key={i} className="text-[12.5px] flex gap-2">
                    <span className="text-ok shrink-0">🔒</span>
                    <span>
                      {h.direction === 'decrease' ? 'Cut' : 'Grow'} {prettifyKpiName(h.kpi)} by{' '}
                      {h.magnitudePct}% within {h.timeframeDays} days
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[12.5px] text-ink-3">
                These become measured commitments. When the feature ships, we&apos;ll check whether
                each of these actually happened — regardless of the outcome.
              </p>
            </>
          }
          confirmLabel="Yes, admit this and lock it in"
          onConfirm={() => void submitDecision()}
          onCancel={() => setShowConfirm(false)}
          busy={submitting}
        />
      )}

      {showConfirm && decision && decision !== 'admit' && (
        <ConfirmDialog
          title={decision === 'defer' ? 'Send back to Listen?' : 'Reject this idea?'}
          body={<p>{rationale}</p>}
          confirmLabel={decision === 'defer' ? 'Yes, defer it' : 'Yes, reject it'}
          onConfirm={() => void submitDecision()}
          onCancel={() => setShowConfirm(false)}
          busy={submitting}
        />
      )}
    </div>
  )
}
