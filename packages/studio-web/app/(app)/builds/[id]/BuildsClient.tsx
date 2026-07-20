'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type Detail = {
  feature_id: number
  title: string
  admitted: boolean
  has_qa: boolean
  status: string
  build: {
    id: number
    title: string
    conclusion: string | null
    git_sha: string | null
    run_id: string | null
  } | null
  iac: { id: number; title: string; description: string } | null
}

export default function BuildsClient({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/builds/${id}`)
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

  async function recordBuild() {
    setRecording(true)
    setError('')
    try {
      const res = await fetch(`/api/builds/${id}/record`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Could not record the pipeline build')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the pipeline build')
    } finally {
      setRecording(false)
    }
  }

  if (loading || recording) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8">
        <p className="text-sm font-semibold text-ink-2 mb-1">
          {recording ? 'Recording the pipeline build…' : 'Loading…'}
        </p>
        <p className="text-[13px] text-ink-3">Capturing the CI run for this case.</p>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-ink-2">{error || 'Case not found'}</p>
        <Link href="/builds" className="inline-block mt-3 text-xs font-bold text-bosch-red">
          ← Back to Builds
        </Link>
      </div>
    )
  }

  if (!detail.admitted) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Not admitted yet</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Pipeline builds are recorded only after Portfolio Review admits the case.
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

  if (!detail.has_qa) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Quality first</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Quality must pass before recording the pipeline build.
        </p>
        <Link
          href={`/quality/${id}`}
          className="inline-block rounded-xl2 px-4 py-2 text-xs font-bold bg-bosch-red text-white"
        >
          Open Quality →
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

      {!detail.build ? (
        <div className="bg-white border border-line rounded-xl3 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-ink-2 mb-1">No pipeline build yet</p>
          <p className="text-[13px] text-ink-3 mb-5 max-w-md mx-auto">
            Record the CI pipeline run that produced the artifact for this case.
          </p>
          {canEdit ? (
            <button
              type="button"
              onClick={() => void recordBuild()}
              className="rounded-xl2 px-4 py-2.5 text-sm font-bold bg-bosch-red text-white"
            >
              Record the pipeline build
            </button>
          ) : (
            <p className="text-[12px] text-ink-3">Only editors can record pipeline builds.</p>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[12px] font-bold text-ok">{detail.status}</div>
            {canEdit && (
              <button
                type="button"
                onClick={() => void recordBuild()}
                className="rounded-xl2 px-3 py-1.5 text-xs font-bold border border-line text-ink-2 hover:border-bosch-red"
              >
                Record again
              </button>
            )}
          </div>

          <div className="bg-white border border-line rounded-xl3 overflow-hidden">
            <div className="px-5 py-3 border-b border-line">
              <h2 className="text-[15px] font-extrabold text-ink-1">{detail.build.title}</h2>
            </div>
            <div className="px-5 py-4 grid gap-3 sm:grid-cols-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">
                  Conclusion
                </div>
                <div className="text-[13px] font-semibold text-ink-1">
                  {detail.build.conclusion || '—'}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">
                  Git SHA
                </div>
                <div className="text-[13px] font-mono text-ink-2">{detail.build.git_sha || '—'}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">
                  Run id
                </div>
                <div className="text-[13px] font-mono text-ink-2">{detail.build.run_id || '—'}</div>
              </div>
            </div>
          </div>

          {detail.iac && (
            <div className="bg-white border border-line rounded-xl3 px-5 py-4">
              <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">
                Infrastructure change
              </div>
              <div className="text-[14px] font-extrabold text-ink-1 mb-1">{detail.iac.title}</div>
              {detail.iac.description ? (
                <p className="text-[13px] text-ink-2 leading-relaxed">{detail.iac.description}</p>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  )
}
