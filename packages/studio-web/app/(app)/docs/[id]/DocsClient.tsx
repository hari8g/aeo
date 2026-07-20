'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type Detail = {
  feature_id: number
  title: string
  admitted: boolean
  has_implementation: boolean
  status: string
  documentation: { id: number; title: string; outline: string } | null
  changelog: { id: number; title: string; body: string } | null
}

export default function DocsClient({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [drafting, setDrafting] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/docs/${id}`)
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

  async function draftDocs() {
    setDrafting(true)
    setError('')
    try {
      const res = await fetch(`/api/docs/${id}/draft`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Could not draft docs')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not draft docs')
    } finally {
      setDrafting(false)
    }
  }

  if (loading || drafting) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8">
        <p className="text-sm font-semibold text-ink-2 mb-1">
          {drafting ? 'Drafting documentation…' : 'Loading…'}
        </p>
        <p className="text-[13px] text-ink-3">Writing the outline and changelog entry.</p>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-ink-2">{error || 'Case not found'}</p>
        <Link href="/docs" className="inline-block mt-3 text-xs font-bold text-bosch-red">
          ← Back to Docs
        </Link>
      </div>
    )
  }

  if (!detail.admitted) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Not admitted yet</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Docs are drafted only after Portfolio Review admits the case.
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
          Record the engineering changeset before drafting documentation.
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

      {!detail.documentation ? (
        <div className="bg-white border border-line rounded-xl3 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-ink-2 mb-1">No docs yet</p>
          <p className="text-[13px] text-ink-3 mb-5 max-w-md mx-auto">
            Draft a product documentation outline and changelog entry for this case.
          </p>
          {canEdit ? (
            <button
              type="button"
              onClick={() => void draftDocs()}
              className="rounded-xl2 px-4 py-2.5 text-sm font-bold bg-bosch-red text-white"
            >
              Draft the docs
            </button>
          ) : (
            <p className="text-[12px] text-ink-3">Only editors can draft docs.</p>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[12px] text-ink-3">{detail.status}</div>
            {canEdit && (
              <button
                type="button"
                onClick={() => void draftDocs()}
                className="rounded-xl2 px-3 py-1.5 text-xs font-bold border border-line text-ink-2 hover:border-bosch-red"
              >
                Draft again
              </button>
            )}
          </div>

          <div className="bg-white border border-line rounded-xl3 overflow-hidden">
            <div className="px-5 py-3 border-b border-line">
              <h2 className="text-[15px] font-extrabold text-ink-1">
                {detail.documentation.title}
              </h2>
            </div>
            <div className="px-5 py-4">
              <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-2">
                Outline
              </div>
              <pre className="text-[13px] text-ink-2 whitespace-pre-wrap font-sans leading-relaxed">
                {detail.documentation.outline}
              </pre>
            </div>
          </div>

          {detail.changelog && (
            <div className="bg-white border border-line rounded-xl3 overflow-hidden">
              <div className="px-5 py-3 border-b border-line">
                <h2 className="text-[13px] font-extrabold text-ink-1">Changelog</h2>
              </div>
              <div className="px-5 py-4">
                <pre className="text-[13px] text-ink-2 whitespace-pre-wrap font-sans leading-relaxed">
                  {detail.changelog.body}
                </pre>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
