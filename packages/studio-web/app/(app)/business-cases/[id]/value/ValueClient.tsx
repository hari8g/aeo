'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import BetCard from '@/components/BetCard'
import ConfidenceBadge from '@/components/ConfidenceBadge'
import { formatMoneyRange } from '@/lib/format'

type Hypothesis = {
  kpi: string
  direction: string
  magnitudePct: number
  timeframeDays: number
  attributionMethod: string
  rationale?: string
}

type ValueData = {
  executiveSummary?: string
  valueLow?: number
  valueHigh?: number
  valueCurrency?: string
  valuePeriod?: string
  valueStartYear?: number
  confidence?: number
  assumptions?: string[]
  hypotheses?: Hypothesis[]
}

type CalibrationRow = {
  metadata?: Record<string, unknown>
  description?: string
  created_at: string
}

function computeTrend(rows: CalibrationRow[]): 'improving' | 'degrading' | 'stable' {
  const scores = rows
    .map((r) => {
      const m = r.metadata ?? {}
      const fromMeta = Number(m.errorPct ?? m.accuracyPct)
      if (Number.isFinite(fromMeta)) return fromMeta
      try {
        const d = JSON.parse(r.description || '{}') as { errorPct?: number; accuracyPct?: number }
        return Number(d.errorPct ?? d.accuracyPct)
      } catch {
        return NaN
      }
    })
    .filter((n) => Number.isFinite(n))
  if (scores.length < 2) return 'stable'
  const recent = scores[0]!
  const older = scores[scores.length - 1]!
  // lower error = better; higher accuracy = better — detect by magnitude
  if (recent < older - 3) return 'improving'
  if (recent > older + 3) return 'degrading'
  return 'stable'
}

function trendSentence(trend: 'improving' | 'degrading' | 'stable'): string {
  if (trend === 'improving')
    return 'Our estimates have been getting closer to what actually happened.'
  if (trend === 'degrading')
    return 'Our recent estimates have been further off than usual — treat this range with a bit more caution.'
  return 'Our estimates have been consistently in the right ballpark.'
}

export default function ValueClient({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [data, setData] = useState<ValueData | null>(null)
  const [calibration, setCalibration] = useState<CalibrationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [estimating, setEstimating] = useState(false)
  const [error, setError] = useState('')
  const [adjusting, setAdjusting] = useState(false)
  const [draftAssumptions, setDraftAssumptions] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/business-cases/${id}/value`)
      const body = (await res.json()) as {
        assessment?: { data: ValueData } | null
        calibration?: CalibrationRow[]
        error?: string
      }
      if (!res.ok) throw new Error(body.error || 'Could not load value assessment')
      setData(body.assessment?.data ?? null)
      setCalibration(Array.isArray(body.calibration) ? body.calibration : [])
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

  const trend = useMemo(() => computeTrend(calibration), [calibration])

  async function runEstimate(assumptions?: string[]) {
    setEstimating(true)
    setError('')
    try {
      const path = assumptions
        ? `/api/business-cases/${id}/value/adjust`
        : `/api/business-cases/${id}/estimate-value`
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assumptions ? { assumptions } : {}),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Estimate failed')
      setAdjusting(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Estimate failed')
    } finally {
      setEstimating(false)
    }
  }

  if (loading || estimating) {
    return (
      <div className="space-y-3">
        <div className="bg-white border border-line rounded-xl3 px-5 py-8">
          <p className="text-sm font-semibold text-ink-2 mb-1">
            {estimating ? 'Estimating value…' : 'Loading…'}
          </p>
          <p className="text-[13px] text-ink-3 mb-5">
            {estimating
              ? 'This takes about 15 seconds — we look at similar past cases to calibrate.'
              : 'Fetching the latest value assessment.'}
          </p>
          <div className="h-16 bg-surface-2 rounded-xl2 animate-pulse mb-4" />
          <div className="h-24 bg-surface-2 rounded-xl2 animate-pulse" />
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="bg-white border border-line rounded-xl3 text-center py-16 px-6">
        <div className="text-4xl mb-3">💰</div>
        <h3 className="font-extrabold text-base text-ink-1 mb-2">
          Let&apos;s figure out what this is worth
        </h3>
        <p className="text-ink-3 text-sm mb-5 max-w-md mx-auto">
          This takes about 15 seconds — we&apos;ll look at similar past cases to calibrate the
          estimate.
        </p>
        {error && (
          <p className="text-xs text-bosch-red font-semibold mb-3">{error}</p>
        )}
        {canEdit ? (
          <button
            type="button"
            onClick={() => void runEstimate()}
            className="rounded-xl2 px-5 py-3 text-sm font-bold bg-bosch-red text-white"
          >
            Estimate the value
          </button>
        ) : (
          <p className="text-sm text-ink-3">Ask an editor or admin to run the value estimate.</p>
        )}
      </div>
    )
  }

  const low = Number(data.valueLow ?? 0)
  const high = Number(data.valueHigh ?? 0)
  const period = data.valuePeriod || 'year'
  const startYear = data.valueStartYear != null ? Number(data.valueStartYear) : null
  const assumptions = data.assumptions ?? []
  const hypotheses = data.hypotheses ?? []

  return (
    <>
      {error && (
        <div className="mb-4 rounded-xl2 border border-pink-bd bg-pink-bg px-4 py-3 text-sm text-bosch-red font-semibold">
          {error}
        </div>
      )}

      <div className="bg-white border border-line rounded-xl3 overflow-hidden">
        <div className="px-5 py-4 border-b border-line">
          <h2 className="text-[16px] font-extrabold text-ink-1">What this is worth</h2>
          <p className="text-[13.5px] text-ink-2 mt-1 whitespace-pre-wrap">{data.executiveSummary}</p>
        </div>

        <div className="px-5 py-5">
          <div className="text-center py-6 border-b border-line mb-6">
            <div className="text-3xl font-extrabold tracking-tight text-ink-1">
              {formatMoneyRange(low, high, data.valueCurrency ?? 'EUR', period, startYear)}
            </div>
            <ConfidenceBadge pct={Number(data.confidence ?? 0)} />
          </div>

          <div className="mb-6">
            <h4 className="text-sm font-bold text-ink-1 mb-2">What we&apos;re assuming</h4>
            {!adjusting ? (
              <>
                <ul className="space-y-1.5">
                  {assumptions.map((a, i) => (
                    <li key={i} className="text-[13px] text-ink-2 flex gap-2">
                      <span className="text-ink-3">•</span>
                      {a}
                    </li>
                  ))}
                </ul>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraftAssumptions(assumptions)
                      setAdjusting(true)
                    }}
                    className="mt-3 rounded-xl2 px-3.5 py-2 text-xs font-bold border border-line bg-white text-ink-2"
                  >
                    ✏ Adjust an assumption
                  </button>
                )}
              </>
            ) : (
              <div className="mt-1 space-y-2">
                {draftAssumptions.map((a, i) => (
                  <textarea
                    key={i}
                    value={a}
                    onChange={(e) => {
                      const next = [...draftAssumptions]
                      next[i] = e.target.value
                      setDraftAssumptions(next)
                    }}
                    className="w-full text-[13px] border border-line rounded-xl2 p-2.5 outline-none focus:border-bosch-red"
                    rows={2}
                  />
                ))}
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setAdjusting(false)}
                    className="rounded-xl2 px-3.5 py-2 text-xs font-bold border border-line bg-white text-ink-2"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void runEstimate(draftAssumptions)}
                    className="rounded-xl2 px-3.5 py-2 text-xs font-bold bg-bosch-red text-white"
                  >
                    Save and re-estimate
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <h4 className="text-sm font-bold text-ink-1 mb-2">What we&apos;ll measure</h4>
            <div className="space-y-2">
              {hypotheses.map((h, i) => (
                <BetCard key={i} hypothesis={h} />
              ))}
            </div>
          </div>

          {calibration.length === 0 ? (
            <div className="mt-6 pt-5 border-t border-line text-[12.5px] text-ink-3">
              This is the first time we&apos;re sizing something like this — there&apos;s no track
              record yet to compare against.
            </div>
          ) : (
            <div className="mt-6 pt-5 border-t border-line">
              <h4 className="text-sm font-bold text-ink-1 mb-3">How accurate have we been?</h4>
              <div className="flex items-center gap-3">
                <span
                  className={`text-lg ${
                    trend === 'improving'
                      ? 'text-ok'
                      : trend === 'degrading'
                        ? 'text-bosch-red'
                        : 'text-ink-3'
                  }`}
                >
                  {trend === 'improving' ? '↗' : trend === 'degrading' ? '↘' : '→'}
                </span>
                <p className="text-[12.5px] text-ink-2">{trendSentence(trend)}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
