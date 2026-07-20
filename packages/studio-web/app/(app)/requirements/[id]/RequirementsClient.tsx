'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type Criterion = { id: number; label: string; description: string }
type Story = {
  id: number
  title: string
  description: string
  criteria: Criterion[]
}

type Detail = {
  feature_id: number
  title: string
  admitted: boolean
  status: string
  stories: Story[]
}

export default function RequirementsClient({
  id,
  canEdit,
}: {
  id: string
  canEdit: boolean
}) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [drafting, setDrafting] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/requirements/${id}`)
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

  async function draftRequirements() {
    setDrafting(true)
    setError('')
    try {
      const res = await fetch(`/api/requirements/${id}/draft`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Could not draft requirements')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not draft requirements')
    } finally {
      setDrafting(false)
    }
  }

  if (loading || drafting) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8">
        <p className="text-sm font-semibold text-ink-2 mb-1">
          {drafting ? 'Drafting user stories…' : 'Loading…'}
        </p>
        <p className="text-[13px] text-ink-3">
          Turning the admitted case into stories and acceptance criteria.
        </p>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-ink-2">{error || 'Case not found'}</p>
        <Link href="/requirements" className="inline-block mt-3 text-xs font-bold text-bosch-red">
          ← Back to Requirements
        </Link>
      </div>
    )
  }

  if (!detail.admitted) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Not admitted yet</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Requirements are drafted only after Portfolio Review admits the case.
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

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl2 border border-pink-bd bg-pink-bg text-pink px-4 py-3 text-sm font-semibold">
          {error}
        </div>
      )}

      {!detail.stories.length ? (
        <div className="bg-white border border-line rounded-xl3 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-ink-2 mb-1">No stories yet</p>
          <p className="text-[13px] text-ink-3 mb-5 max-w-md mx-auto">
            Draft user stories and acceptance criteria from the admitted business case — what
            we&apos;re building and how we&apos;ll know it&apos;s done.
          </p>
          {canEdit ? (
            <button
              type="button"
              onClick={() => void draftRequirements()}
              className="rounded-xl2 px-4 py-2.5 text-sm font-bold bg-bosch-red text-white"
            >
              Draft the requirements
            </button>
          ) : (
            <p className="text-[12px] text-ink-3">Only editors can draft requirements.</p>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[12px] text-ink-3">
              {detail.stories.length} stor{detail.stories.length === 1 ? 'y' : 'ies'} ·{' '}
              {detail.stories.reduce((n, s) => n + s.criteria.length, 0)} acceptance criteria
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => void draftRequirements()}
                className="rounded-xl2 px-3 py-1.5 text-xs font-bold border border-line text-ink-2 hover:border-bosch-red"
              >
                Draft again
              </button>
            )}
          </div>

          <div className="space-y-4">
            {detail.stories.map((story, i) => (
              <div
                key={story.id}
                className="bg-white border border-line rounded-xl3 overflow-hidden"
              >
                <div className="px-5 py-3 border-b border-line flex items-start gap-3">
                  <span className="text-[11px] font-bold text-ink-3 shrink-0 mt-0.5">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-extrabold text-ink-1">{story.title}</h2>
                    {story.description ? (
                      <p className="text-[13px] text-ink-2 mt-1 leading-relaxed">
                        {story.description}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="px-5 py-4">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-2">
                    Done when
                  </div>
                  <ul className="space-y-2">
                    {story.criteria.map((c) => (
                      <li
                        key={c.id}
                        className="flex gap-2.5 text-[13px] text-ink-2 border border-line rounded-xl2 px-3 py-2.5 bg-surface-1"
                      >
                        <span className="text-ok font-bold shrink-0">✓</span>
                        <div className="min-w-0">
                          <div className="font-semibold text-ink-1">{c.label}</div>
                          {c.description ? (
                            <div className="text-[12px] text-ink-3 mt-0.5">{c.description}</div>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
