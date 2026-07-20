'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type Detail = {
  feature_id: number
  title: string
  admitted: boolean
  has_implementation: boolean
  status: string
  blocked: boolean
  suites: Array<{ id: number; title: string; summary: string }>
  runs: Array<{
    id: number
    title: string
    conclusion: string
    passed: number
    failed: number
    summary: string
  }>
  cases: Array<{
    id: number
    name: string
    status: string
    severity: string
    suite_id: number
  }>
}

export default function QualityClient({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/quality/${id}`)
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

  async function runQuality() {
    setRunning(true)
    setError('')
    try {
      const res = await fetch(`/api/quality/${id}/run`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Could not run quality checks')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not run quality checks')
    } finally {
      setRunning(false)
    }
  }

  if (loading || running) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8">
        <p className="text-sm font-semibold text-ink-2 mb-1">
          {running ? 'Running quality checks…' : 'Loading…'}
        </p>
        <p className="text-[13px] text-ink-3">Evaluating the quality gate for this case.</p>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-ink-2">{error || 'Case not found'}</p>
        <Link href="/quality" className="inline-block mt-3 text-xs font-bold text-bosch-red">
          ← Back to Quality
        </Link>
      </div>
    )
  }

  if (!detail.admitted) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Not admitted yet</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Quality checks run only after Portfolio Review admits the case.
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

  if (!detail.has_implementation) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Implementation first</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Record the engineering changeset before running the quality gate.
        </p>
        <Link
          href={`/build/${id}`}
          className="inline-block rounded-xl2 px-4 py-2 text-xs font-bold bg-bosch-red text-white"
        >
          Open Implementation →
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

      {!detail.suites.length ? (
        <div className="bg-white border border-line rounded-xl3 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-ink-2 mb-1">No quality results yet</p>
          <p className="text-[13px] text-ink-3 mb-5 max-w-md mx-auto">
            Run the quality gate against the recorded implementation.
          </p>
          {canEdit ? (
            <button
              type="button"
              onClick={() => void runQuality()}
              className="rounded-xl2 px-4 py-2.5 text-sm font-bold bg-bosch-red text-white"
            >
              Run quality checks
            </button>
          ) : (
            <p className="text-[12px] text-ink-3">Only editors can run quality checks.</p>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div
              className={`text-[12px] font-bold ${detail.blocked ? 'text-pink' : 'text-ok'}`}
            >
              {detail.status}
              {detail.runs[0]
                ? ` · ${detail.runs[0].passed} passed · ${detail.runs[0].failed} failed`
                : ''}
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => void runQuality()}
                className="rounded-xl2 px-3 py-1.5 text-xs font-bold border border-line text-ink-2 hover:border-bosch-red"
              >
                Run again
              </button>
            )}
          </div>

          {detail.runs[0]?.summary && (
            <div className="bg-white border border-line rounded-xl3 px-5 py-4">
              <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">
                Summary
              </div>
              <p className="text-[13px] text-ink-2 leading-relaxed">{detail.runs[0].summary}</p>
            </div>
          )}

          <div className="bg-white border border-line rounded-xl3 overflow-hidden">
            <div className="px-5 py-3 border-b border-line">
              <h2 className="text-[13px] font-extrabold text-ink-1">Checks</h2>
            </div>
            <ul className="divide-y divide-line">
              {detail.cases.map((c) => {
                const failed = /fail|error|broken/i.test(c.status)
                return (
                  <li key={c.id} className="px-5 py-3 flex items-center gap-3">
                    <span className={`text-sm font-bold ${failed ? 'text-pink' : 'text-ok'}`}>
                      {failed ? '✗' : '✓'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-ink-1">{c.name}</div>
                      <div className="text-[11px] text-ink-3 capitalize">
                        {c.status}
                        {c.severity && c.severity !== 'info' ? ` · ${c.severity}` : ''}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
