'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type Detail = {
  feature_id: number
  title: string
  admitted: boolean
  has_safety: boolean
  status: string
  report: {
    id: number
    title: string
    ready: boolean
    approval_set: string[]
    signed: Array<{ role: string; decision: string }>
  } | null
}

export default function ReleaseClient({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/release/${id}`)
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

  async function checkReadiness() {
    setBusy('check')
    setError('')
    try {
      const res = await fetch(`/api/release/${id}/check`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Could not check readiness')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check readiness')
    } finally {
      setBusy('')
    }
  }

  async function approveRelease() {
    setBusy('approve')
    setError('')
    try {
      const res = await fetch(`/api/release/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'all' }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Could not approve release')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve release')
    } finally {
      setBusy('')
    }
  }

  if (loading || busy) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8">
        <p className="text-sm font-semibold text-ink-2 mb-1">
          {busy === 'check'
            ? 'Checking readiness…'
            : busy === 'approve'
              ? 'Approving release…'
              : 'Loading…'}
        </p>
        <p className="text-[13px] text-ink-3">Evaluating the release gate for this case.</p>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-ink-2">{error || 'Case not found'}</p>
        <Link href="/release" className="inline-block mt-3 text-xs font-bold text-bosch-red">
          ← Back to Release
        </Link>
      </div>
    )
  }

  if (!detail.admitted) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Not admitted yet</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Release checks run only after Portfolio Review admits the case.
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

  if (!detail.has_safety) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Safety first</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Run safety checks before checking release readiness.
        </p>
        <Link
          href={`/safety/${id}`}
          className="inline-block rounded-xl2 px-4 py-2 text-xs font-bold bg-bosch-red text-white"
        >
          Open Safety →
        </Link>
      </div>
    )
  }

  const ready = !!detail.report?.ready
  const awaitingSignOff = ready && detail.status === 'Awaiting release sign-off'
  const approved = detail.status === 'Release approved'

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl2 border border-pink-bd bg-pink-bg text-pink px-4 py-3 text-sm font-semibold">
          {error}
        </div>
      )}

      {!detail.report ? (
        <div className="bg-white border border-line rounded-xl3 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-ink-2 mb-1">No readiness check yet</p>
          <p className="text-[13px] text-ink-3 mb-5 max-w-md mx-auto">
            Check whether security, cost, and build gates are clear for release.
          </p>
          {canEdit ? (
            <button
              type="button"
              onClick={() => void checkReadiness()}
              className="rounded-xl2 px-4 py-2.5 text-sm font-bold bg-bosch-red text-white"
            >
              Check readiness
            </button>
          ) : (
            <p className="text-[12px] text-ink-3">Only editors can check readiness.</p>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              className={`text-[12px] font-bold ${
                detail.status === 'Not ready' ? 'text-pink' : ready ? 'text-ok' : 'text-amber'
              }`}
            >
              {detail.status}
            </div>
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void checkReadiness()}
                  className="rounded-xl2 px-3 py-1.5 text-xs font-bold border border-line text-ink-2 hover:border-bosch-red"
                >
                  Check readiness
                </button>
                {awaitingSignOff && (
                  <button
                    type="button"
                    onClick={() => void approveRelease()}
                    className="rounded-xl2 px-3 py-1.5 text-xs font-bold bg-bosch-red text-white"
                  >
                    Approve release
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="bg-white border border-line rounded-xl3 overflow-hidden">
            <div className="px-5 py-3 border-b border-line flex items-start justify-between gap-3">
              <h2 className="text-[15px] font-extrabold text-ink-1">{detail.report.title}</h2>
              <span
                className={`shrink-0 text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 ${
                  ready
                    ? 'bg-ok-bg text-ok border-ok-bd'
                    : 'bg-pink-bg text-pink border-pink-bd'
                }`}
              >
                {ready ? 'Ready' : 'Not ready'}
              </span>
            </div>
            <div className="px-5 py-4">
              <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-2">
                Sign-off
              </div>
              {detail.report.approval_set.length === 0 ? (
                <p className="text-[13px] text-ink-3">No roles required.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.report.approval_set.map((role) => {
                    const signed = detail.report!.signed.find((s) => s.role === role)
                    return (
                      <li
                        key={role}
                        className="flex items-center justify-between text-[13px] border border-line rounded-xl2 px-3 py-2"
                      >
                        <span className="font-semibold text-ink-1 capitalize">{role}</span>
                        <span className={signed ? 'text-ok font-bold' : 'text-ink-3'}>
                          {signed ? signed.decision : 'Pending'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>

          {awaitingSignOff && canEdit && (
            <div className="bg-white border border-line rounded-xl3 px-6 py-8 text-center">
              <p className="text-sm font-semibold text-ink-2 mb-1">Ready for sign-off</p>
              <p className="text-[13px] text-ink-3 mb-5 max-w-md mx-auto">
                All gates cleared. Approve the release to unlock rollout.
              </p>
              <button
                type="button"
                onClick={() => void approveRelease()}
                className="rounded-xl2 px-4 py-2.5 text-sm font-bold bg-bosch-red text-white"
              >
                Approve release
              </button>
            </div>
          )}

          {approved && (
            <div className="border border-ok-bd bg-ok-bg rounded-xl2 px-5 py-4">
              <p className="text-sm font-bold text-ok mb-1">Release approved</p>
              <p className="text-[13px] text-ink-2 mb-3">
                This case is cleared for production rollout.
              </p>
              <Link
                href={`/rollout/${id}`}
                className="inline-block rounded-xl2 px-4 py-2 text-xs font-bold bg-bosch-red text-white"
              >
                Go to Rollout →
              </Link>
            </div>
          )}

          {!canEdit && awaitingSignOff && (
            <p className="text-[12px] text-ink-3">Only editors can approve release.</p>
          )}
        </>
      )}
    </div>
  )
}
