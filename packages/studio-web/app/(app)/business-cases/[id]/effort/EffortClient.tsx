'use client'

import { useCallback, useEffect, useState } from 'react'
import ComplexityBadge from '@/components/ComplexityBadge'
import EffortBreakdown from '@/components/EffortBreakdown'
import GroundingCard from '@/components/GroundingCard'

type EffortData = {
  summary?: string
  effortWeeksLow?: number
  effortWeeksHigh?: number
  complexity?: string
  technicalRisks?: string[]
  assumptions?: string[]
  breakdown?: Record<string, number>
  recommendedTeamSize?: number
  codeComplexitySignal?: string
  applicableRegulations?: string[]
  addressedRiskIndices?: number[]
}

export default function EffortClient({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [data, setData] = useState<EffortData | null>(null)
  const [loading, setLoading] = useState(true)
  const [estimating, setEstimating] = useState(false)
  const [error, setError] = useState('')
  const [busyRisk, setBusyRisk] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/business-cases/${id}/effort`)
      const body = (await res.json()) as {
        assessment?: { data: EffortData } | null
        error?: string
      }
      if (!res.ok) throw new Error(body.error || 'Could not load effort assessment')
      setData(body.assessment?.data ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function runEstimate() {
    setEstimating(true)
    setError('')
    try {
      const res = await fetch(`/api/business-cases/${id}/estimate-effort`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Estimate failed')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Estimate failed')
    } finally {
      setEstimating(false)
    }
  }

  async function markRiskAddressed(riskIndex: number) {
    setBusyRisk(riskIndex)
    setError('')
    try {
      const res = await fetch(`/api/business-cases/${id}/effort/risk-addressed`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ riskIndex }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || 'Could not update risk')
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update risk')
    } finally {
      setBusyRisk(null)
    }
  }

  async function reestimate() {
    setEstimating(true)
    setError('')
    try {
      const res = await fetch(`/api/business-cases/${id}/effort/reestimate`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Re-estimate failed')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Re-estimate failed')
    } finally {
      setEstimating(false)
    }
  }

  if (loading || estimating) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8">
        <p className="text-sm font-semibold text-ink-2 mb-1">
          {estimating ? 'Estimating effort…' : 'Loading…'}
        </p>
        <p className="text-[13px] text-ink-3 mb-5">
          {estimating
            ? 'This takes about 15 seconds — we check how similar changes have gone before.'
            : 'Fetching the latest effort assessment.'}
        </p>
        <div className="h-16 bg-surface-2 rounded-xl2 animate-pulse mb-4" />
        <div className="h-24 bg-surface-2 rounded-xl2 animate-pulse" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="bg-white border border-line rounded-xl3 text-center py-16 px-6">
        <div className="text-4xl mb-3">🏗️</div>
        <h3 className="font-extrabold text-base text-ink-1 mb-2">
          Let&apos;s figure out how much work this is
        </h3>
        <p className="text-ink-3 text-sm mb-5 max-w-md mx-auto">
          This takes about 15 seconds — we&apos;ll check how similar changes have gone before. You
          don&apos;t need to wait on the Business Value tab.
        </p>
        {error && <p className="text-xs text-bosch-red font-semibold mb-3">{error}</p>}
        {canEdit ? (
          <button
            type="button"
            onClick={() => void runEstimate()}
            className="rounded-xl2 px-5 py-3 text-sm font-bold bg-bosch-red text-white"
          >
            Estimate the effort
          </button>
        ) : (
          <p className="text-sm text-ink-3">Ask an editor or admin to run the effort estimate.</p>
        )}
      </div>
    )
  }

  const low = Number(data.effortWeeksLow ?? 0)
  const high = Number(data.effortWeeksHigh ?? 0)
  const risks = data.technicalRisks ?? []
  const addressed = new Set(data.addressedRiskIndices ?? [])
  const regs = data.applicableRegulations ?? []

  return (
    <>
      {error && (
        <div className="mb-4 rounded-xl2 border border-pink-bd bg-pink-bg px-4 py-3 text-sm text-bosch-red font-semibold">
          {error}
        </div>
      )}

      <div className="bg-white border border-line rounded-xl3 overflow-hidden">
        <div className="px-5 py-4 border-b border-line">
          <h2 className="text-[16px] font-extrabold text-ink-1">How much work this is</h2>
          <p className="text-[13.5px] text-ink-2 mt-1">{data.summary}</p>
        </div>

        <div className="px-5 py-5">
          <div className="text-center py-6 border-b border-line mb-6">
            <div className="text-3xl font-extrabold tracking-tight text-ink-1">
              {low} – {high}
              <span className="text-base font-medium text-ink-3"> weeks</span>
            </div>
            <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
              <ComplexityBadge level={data.complexity ?? 'medium'} />
              <span className="text-ink-3 text-[12px]">·</span>
              <span className="text-[12.5px] text-ink-2">
                Best done by a team of {data.recommendedTeamSize ?? 2}
              </span>
            </div>
          </div>

          <div className="mb-6">
            <h4 className="text-sm font-bold text-ink-1 mb-2">What could slow this down</h4>
            {risks.length === 0 ? (
              <p className="text-[12.5px] text-ink-3">
                No specific risks flagged — this looks fairly straightforward.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {risks.map((risk, i) => {
                  const done = addressed.has(i)
                  return (
                    <li
                      key={i}
                      className="text-[13px] text-ink-2 flex items-center gap-2 group"
                    >
                      <span className="text-amber shrink-0">⚠</span>
                      <span className={done ? 'line-through text-ink-3' : ''}>{risk}</span>
                      {canEdit && !done && (
                        <button
                          type="button"
                          disabled={busyRisk === i}
                          onClick={() => void markRiskAddressed(i)}
                          className="text-[10.5px] font-bold text-blue ml-auto opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                        >
                          {busyRisk === i ? 'Saving…' : 'Mark as handled'}
                        </button>
                      )}
                      {done && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-ok ml-auto">
                          Handled
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            {canEdit && addressed.size > 0 && (
              <div className="mt-3 p-3 bg-blue-bg border border-blue-bd rounded-xl2 flex items-center justify-between gap-3 flex-wrap">
                <span className="text-[12.5px] text-blue">
                  {addressed.size} risk{addressed.size > 1 ? 's' : ''} marked as handled — the
                  estimate above doesn&apos;t reflect this yet.
                </span>
                <button
                  type="button"
                  onClick={() => void reestimate()}
                  className="rounded-xl2 px-3.5 py-2 text-xs font-bold bg-bosch-red text-white shrink-0"
                >
                  Re-estimate
                </button>
              </div>
            )}
          </div>

          <div className="mb-6">
            <h4 className="text-sm font-bold text-ink-1 mb-2">Where the time goes</h4>
            <EffortBreakdown breakdown={data.breakdown} />
          </div>

          <div className="mt-6 pt-5 border-t border-line">
            <h4 className="text-sm font-bold text-ink-1 mb-3">What we looked at</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <GroundingCard
                icon="🗂️"
                title="Similar past changes"
                body={
                  data.codeComplexitySignal ??
                  'We compared this to how similar parts of the system have changed before.'
                }
              />
              <GroundingCard
                icon="📋"
                title="Rules that apply here"
                body={
                  regs.length > 0
                    ? `${regs.length} compliance rule${regs.length > 1 ? 's' : ''} apply — this typically adds review time.`
                    : 'No special compliance rules apply to this area.'
                }
              />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
