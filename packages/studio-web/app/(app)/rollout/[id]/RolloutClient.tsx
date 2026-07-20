'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type Detail = {
  feature_id: number
  title: string
  admitted: boolean
  release_ready: boolean
  status: string
  deployment: {
    id: number
    title: string
    status: string | null
    environment: string | null
  } | null
  observations: Array<{
    id: number
    label: string
    sli: unknown
    target: unknown
    healthy: boolean
  }>
}

export default function RolloutClient({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/rollout/${id}`)
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

  async function recordRollout() {
    setBusy('deploy')
    setError('')
    try {
      const res = await fetch(`/api/rollout/${id}/deploy`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Could not record rollout')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record rollout')
    } finally {
      setBusy('')
    }
  }

  async function checkHealth() {
    setBusy('observe')
    setError('')
    try {
      const res = await fetch(`/api/rollout/${id}/observe`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Could not check health')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check health')
    } finally {
      setBusy('')
    }
  }

  if (loading || busy) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8">
        <p className="text-sm font-semibold text-ink-2 mb-1">
          {busy === 'deploy'
            ? 'Recording rollout…'
            : busy === 'observe'
              ? 'Checking health…'
              : 'Loading…'}
        </p>
        <p className="text-[13px] text-ink-3">Updating production status for this case.</p>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-ink-2">{error || 'Case not found'}</p>
        <Link href="/rollout" className="inline-block mt-3 text-xs font-bold text-bosch-red">
          ← Back to Rollout
        </Link>
      </div>
    )
  }

  if (!detail.admitted) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Not admitted yet</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Rollout is recorded only after Portfolio Review admits the case.
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

  if (!detail.release_ready) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Release approval first</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Approve the release before recording the production rollout.
        </p>
        <Link
          href={`/release/${id}`}
          className="inline-block rounded-xl2 px-4 py-2 text-xs font-bold bg-bosch-red text-white"
        >
          Open Release →
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

      {!detail.deployment ? (
        <div className="bg-white border border-line rounded-xl3 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-ink-2 mb-1">No rollout yet</p>
          <p className="text-[13px] text-ink-3 mb-5 max-w-md mx-auto">
            Record the production deploy for this approved release.
          </p>
          {canEdit ? (
            <button
              type="button"
              onClick={() => void recordRollout()}
              className="rounded-xl2 px-4 py-2.5 text-sm font-bold bg-bosch-red text-white"
            >
              Record rollout
            </button>
          ) : (
            <p className="text-[12px] text-ink-3">Only editors can record rollout.</p>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[12px] font-bold text-ok">{detail.status}</div>
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void recordRollout()}
                  className="rounded-xl2 px-3 py-1.5 text-xs font-bold border border-line text-ink-2 hover:border-bosch-red"
                >
                  Record again
                </button>
                <button
                  type="button"
                  onClick={() => void checkHealth()}
                  className="rounded-xl2 px-3 py-1.5 text-xs font-bold bg-bosch-red text-white"
                >
                  Check health
                </button>
              </div>
            )}
          </div>

          <div className="bg-white border border-line rounded-xl3 px-5 py-4">
            <div className="text-[15px] font-extrabold text-ink-1 mb-2">
              {detail.deployment.title}
            </div>
            <div className="flex flex-wrap gap-4 text-[13px] text-ink-2">
              <span>
                Status:{' '}
                <strong className="text-ink-1">{String(detail.deployment.status ?? '—')}</strong>
              </span>
              <span>
                Environment:{' '}
                <strong className="text-ink-1">
                  {String(detail.deployment.environment ?? '—')}
                </strong>
              </span>
            </div>
          </div>

          {!detail.observations.length ? (
            <div className="bg-white border border-line rounded-xl3 px-6 py-8 text-center">
              <p className="text-sm font-semibold text-ink-2 mb-1">No health data yet</p>
              <p className="text-[13px] text-ink-3 mb-5 max-w-md mx-auto">
                Check live metrics after the deploy lands.
              </p>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => void checkHealth()}
                  className="rounded-xl2 px-4 py-2.5 text-sm font-bold bg-bosch-red text-white"
                >
                  Check health
                </button>
              ) : (
                <p className="text-[12px] text-ink-3">Only editors can check health.</p>
              )}
            </div>
          ) : (
            <div className="bg-white border border-line rounded-xl3 overflow-hidden">
              <div className="px-5 py-3 border-b border-line">
                <h2 className="text-[13px] font-extrabold text-ink-1">Live metrics</h2>
              </div>
              <ul className="divide-y divide-line">
                {detail.observations.map((o) => (
                  <li key={o.id} className="px-5 py-3 flex items-center gap-3">
                    <span className={`text-sm font-bold ${o.healthy ? 'text-ok' : 'text-pink'}`}>
                      {o.healthy ? '✓' : '✗'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-ink-1">{o.label}</div>
                      <div className="text-[11px] text-ink-3">
                        SLI {String(o.sli ?? '—')}
                        {o.target != null ? ` · target ${String(o.target)}` : ''}
                      </div>
                    </div>
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
