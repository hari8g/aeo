'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type Detail = {
  feature_id: number
  title: string
  admitted: boolean
  has_build: boolean
  status: string
  scan: {
    id: number
    title: string
    blocking: boolean
    critical: number
    high: number
    summary: string
  } | null
  findings: Array<{
    id: number
    title: string
    severity: string
    description: string
  }>
  cost: {
    id: number
    title: string
    monthly_cost: number
    threshold: number
    exceeds: boolean
  } | null
}

function severityChip(severity: string) {
  const s = String(severity).toLowerCase()
  if (s === 'critical' || s === 'high') return 'bg-pink-bg text-pink border-pink-bd'
  if (s === 'medium') return 'bg-amber-bg text-amber border-amber-bd'
  return 'bg-ok-bg text-ok border-ok-bd'
}

export default function SafetyClient({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/safety/${id}`)
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

  async function runSafety() {
    setRunning(true)
    setError('')
    try {
      const res = await fetch(`/api/safety/${id}/run`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Could not run safety checks')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not run safety checks')
    } finally {
      setRunning(false)
    }
  }

  if (loading || running) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8">
        <p className="text-sm font-semibold text-ink-2 mb-1">
          {running ? 'Running safety checks…' : 'Loading…'}
        </p>
        <p className="text-[13px] text-ink-3">Scanning security and cost for this case.</p>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-ink-2">{error || 'Case not found'}</p>
        <Link href="/safety" className="inline-block mt-3 text-xs font-bold text-bosch-red">
          ← Back to Safety
        </Link>
      </div>
    )
  }

  if (!detail.admitted) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Not admitted yet</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Safety checks run only after Portfolio Review admits the case.
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

  if (!detail.has_build) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Pipeline build first</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Record the pipeline build before running security and cost checks.
        </p>
        <Link
          href={`/builds/${id}`}
          className="inline-block rounded-xl2 px-4 py-2 text-xs font-bold bg-bosch-red text-white"
        >
          Open Builds →
        </Link>
      </div>
    )
  }

  const hasResults = !!(detail.scan && detail.cost)

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl2 border border-pink-bd bg-pink-bg text-pink px-4 py-3 text-sm font-semibold">
          {error}
        </div>
      )}

      {!hasResults ? (
        <div className="bg-white border border-line rounded-xl3 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-ink-2 mb-1">No safety results yet</p>
          <p className="text-[13px] text-ink-3 mb-5 max-w-md mx-auto">
            Run the security scan and cost estimate against the recorded build.
          </p>
          {canEdit ? (
            <button
              type="button"
              onClick={() => void runSafety()}
              className="rounded-xl2 px-4 py-2.5 text-sm font-bold bg-bosch-red text-white"
            >
              Run safety checks
            </button>
          ) : (
            <p className="text-[12px] text-ink-3">Only editors can run safety checks.</p>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div
              className={`text-[12px] font-bold ${
                detail.status === 'Safety blocked' ? 'text-pink' : 'text-ok'
              }`}
            >
              {detail.status}
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => void runSafety()}
                className="rounded-xl2 px-3 py-1.5 text-xs font-bold border border-line text-ink-2 hover:border-bosch-red"
              >
                Run again
              </button>
            )}
          </div>

          {detail.scan && (
            <div className="bg-white border border-line rounded-xl3 overflow-hidden">
              <div className="px-5 py-3 border-b border-line flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-extrabold text-ink-1">{detail.scan.title}</h2>
                  {detail.scan.summary ? (
                    <p className="text-[13px] text-ink-2 mt-1 leading-relaxed">
                      {detail.scan.summary}
                    </p>
                  ) : null}
                </div>
                <span
                  className={`shrink-0 text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 ${
                    detail.scan.blocking
                      ? 'bg-pink-bg text-pink border-pink-bd'
                      : 'bg-ok-bg text-ok border-ok-bd'
                  }`}
                >
                  {detail.scan.blocking ? 'Blocking' : 'Clear'}
                </span>
              </div>
              <div className="px-5 py-3 flex gap-4 text-[12px] text-ink-2">
                <span>
                  <strong className="text-ink-1">{detail.scan.critical}</strong> critical
                </span>
                <span>
                  <strong className="text-ink-1">{detail.scan.high}</strong> high
                </span>
              </div>
              {detail.findings.length > 0 && (
                <ul className="divide-y divide-line border-t border-line">
                  {detail.findings.map((f) => (
                    <li key={f.id} className="px-5 py-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[13px] font-semibold text-ink-1">{f.title}</span>
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 ${severityChip(String(f.severity))}`}
                        >
                          {String(f.severity)}
                        </span>
                      </div>
                      {f.description ? (
                        <p className="text-[12px] text-ink-3">{f.description}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {detail.cost && (
            <div className="bg-white border border-line rounded-xl3 px-5 py-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="text-[14px] font-extrabold text-ink-1">{detail.cost.title}</div>
                <span
                  className={`shrink-0 text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 ${
                    detail.cost.exceeds
                      ? 'bg-pink-bg text-pink border-pink-bd'
                      : 'bg-ok-bg text-ok border-ok-bd'
                  }`}
                >
                  {detail.cost.exceeds ? 'Over budget' : 'Within budget'}
                </span>
              </div>
              <p className="text-[13px] text-ink-2">
                €{detail.cost.monthly_cost.toLocaleString()} / month
                <span className="text-ink-3">
                  {' '}
                  (threshold €{detail.cost.threshold.toLocaleString()})
                </span>
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
