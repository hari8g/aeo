'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type Detail = {
  feature_id: number
  title: string
  admitted: boolean
  has_verdict: boolean
  cycle_stage: string | null
  closed: boolean
  status: string
  learnings: Array<{ id: number; title: string; body: string }>
  calibrations: Array<{
    id: number
    title: string
    body: string
    error_pct: unknown
  }>
  drifts: Array<{ id: number; title: string; body: string }>
}

export default function LessonsClient({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/lessons/${id}`)
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

  async function captureLessons() {
    setBusy('capture')
    setError('')
    try {
      const res = await fetch(`/api/lessons/${id}/capture`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Could not capture lessons')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not capture lessons')
    } finally {
      setBusy('')
    }
  }

  async function closeLoop() {
    setBusy('close')
    setError('')
    try {
      const res = await fetch(`/api/lessons/${id}/close`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Could not close the loop')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not close the loop')
    } finally {
      setBusy('')
    }
  }

  if (loading || busy) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8">
        <p className="text-sm font-semibold text-ink-2 mb-1">
          {busy === 'capture'
            ? 'Capturing lessons…'
            : busy === 'close'
              ? 'Closing the loop…'
              : 'Loading…'}
        </p>
        <p className="text-[13px] text-ink-3">Recording organizational learning for this case.</p>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-ink-2">{error || 'Case not found'}</p>
        <Link href="/lessons" className="inline-block mt-3 text-xs font-bold text-bosch-red">
          ← Back to Lessons
        </Link>
      </div>
    )
  }

  if (!detail.admitted) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Not admitted yet</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Lessons are captured only after Portfolio Review admits the case.
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
          Judge the outcomes before capturing lessons and closing the loop.
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

  const hasLessons = detail.learnings.length > 0

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl2 border border-pink-bd bg-pink-bg text-pink px-4 py-3 text-sm font-semibold">
          {error}
        </div>
      )}

      {detail.closed ? (
        <div className="border border-ok-bd bg-ok-bg rounded-xl2 px-5 py-5">
          <div className="font-bold text-ok text-sm mb-2">Cycle closed</div>
          <p className="text-[13px] text-ink-2 mb-4">
            Lessons and calibration are ready for the next Listen pass.
          </p>
          <Link
            href="/pain-points"
            className="inline-block rounded-xl2 px-4 py-2 text-xs font-bold bg-bosch-red text-white"
          >
            Back to Pain Points →
          </Link>
        </div>
      ) : null}

      {!hasLessons && !detail.closed ? (
        <div className="bg-white border border-line rounded-xl3 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-ink-2 mb-1">No lessons yet</p>
          <p className="text-[13px] text-ink-3 mb-5 max-w-md mx-auto">
            Capture what this cycle taught the organization before closing the loop.
          </p>
          {canEdit ? (
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => void captureLessons()}
                className="rounded-xl2 px-4 py-2.5 text-sm font-bold bg-bosch-red text-white"
              >
                Capture lessons
              </button>
              <button
                type="button"
                onClick={() => void closeLoop()}
                className="rounded-xl2 px-4 py-2.5 text-sm font-bold border border-line text-ink-2 hover:border-bosch-red"
              >
                Close the loop
              </button>
            </div>
          ) : (
            <p className="text-[12px] text-ink-3">Only editors can capture lessons.</p>
          )}
        </div>
      ) : (
        <>
          {!detail.closed && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-[12px] font-bold text-ok">{detail.status}</div>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void captureLessons()}
                    className="rounded-xl2 px-3 py-1.5 text-xs font-bold border border-line text-ink-2 hover:border-bosch-red"
                  >
                    Capture lessons
                  </button>
                  <button
                    type="button"
                    onClick={() => void closeLoop()}
                    className="rounded-xl2 px-3 py-1.5 text-xs font-bold bg-bosch-red text-white"
                  >
                    Close the loop
                  </button>
                </div>
              )}
            </div>
          )}

          {hasLessons && !detail.closed && canEdit && (
            <div className="bg-white border-2 border-bosch-red rounded-xl3 px-6 py-8 text-center">
              <p className="text-sm font-semibold text-ink-2 mb-1">Ready to close the loop</p>
              <p className="text-[13px] text-ink-3 mb-5 max-w-md mx-auto">
                Lessons are captured. Close the cycle so they feed the next Listen pass.
              </p>
              <button
                type="button"
                onClick={() => void closeLoop()}
                className="rounded-xl2 px-4 py-2.5 text-sm font-bold bg-bosch-red text-white"
              >
                Close the loop
              </button>
            </div>
          )}

          {detail.learnings.length > 0 && (
            <div className="space-y-3">
              {detail.learnings.map((l) => (
                <div key={l.id} className="bg-white border border-line rounded-xl3 px-5 py-4">
                  <h2 className="text-[15px] font-extrabold text-ink-1 mb-1">{l.title}</h2>
                  {l.body ? (
                    <p className="text-[13px] text-ink-2 leading-relaxed">{l.body}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {detail.calibrations.length > 0 && (
            <div className="bg-white border border-line rounded-xl3 overflow-hidden">
              <div className="px-5 py-3 border-b border-line">
                <h2 className="text-[13px] font-extrabold text-ink-1">Calibration</h2>
              </div>
              <ul className="divide-y divide-line">
                {detail.calibrations.map((c) => (
                  <li key={c.id} className="px-5 py-3">
                    <div className="text-[13px] font-semibold text-ink-1 mb-1">{c.title}</div>
                    {c.body ? <p className="text-[12px] text-ink-2 mb-1">{c.body}</p> : null}
                    {c.error_pct != null ? (
                      <div className="text-[11px] text-ink-3">
                        Error {String(c.error_pct)}%
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {detail.drifts.length > 0 && (
            <div className="bg-white border border-line rounded-xl3 overflow-hidden">
              <div className="px-5 py-3 border-b border-line">
                <h2 className="text-[13px] font-extrabold text-ink-1">Drift alerts</h2>
              </div>
              <ul className="divide-y divide-line">
                {detail.drifts.map((d) => (
                  <li key={d.id} className="px-5 py-3">
                    <div className="text-[13px] font-semibold text-ink-1">{d.title}</div>
                    {d.body ? <p className="text-[12px] text-ink-2 mt-1">{d.body}</p> : null}
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
