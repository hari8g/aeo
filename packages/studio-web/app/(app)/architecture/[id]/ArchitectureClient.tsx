'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type Context = {
  id: number
  name: string
  description: string
  depends_on: string[]
}

type Interface = {
  id: number
  name: string
  description: string
  protocol: string
  context: string
}

type Detail = {
  feature_id: number
  title: string
  admitted: boolean
  has_stories: boolean
  status: string
  contexts: Context[]
  interfaces: Interface[]
}

export default function ArchitectureClient({
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
      const res = await fetch(`/api/architecture/${id}`)
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

  async function draftArchitecture() {
    setDrafting(true)
    setError('')
    try {
      const res = await fetch(`/api/architecture/${id}/draft`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Could not propose architecture')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not propose architecture')
    } finally {
      setDrafting(false)
    }
  }

  if (loading || drafting) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8">
        <p className="text-sm font-semibold text-ink-2 mb-1">
          {drafting ? 'Proposing architecture…' : 'Loading…'}
        </p>
        <p className="text-[13px] text-ink-3">
          Turning stories into bounded contexts and service interfaces.
        </p>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-ink-2">{error || 'Case not found'}</p>
        <Link href="/architecture" className="inline-block mt-3 text-xs font-bold text-bosch-red">
          ← Back to Architecture
        </Link>
      </div>
    )
  }

  if (!detail.admitted) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Not admitted yet</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Architecture is proposed only after Portfolio Review admits the case.
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

  if (!detail.has_stories) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Requirements first</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Draft user stories before proposing architecture — contexts should map to what we
          committed to build.
        </p>
        <Link
          href={`/requirements/${id}`}
          className="inline-block rounded-xl2 px-4 py-2 text-xs font-bold bg-bosch-red text-white"
        >
          Open Requirements →
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

      {!detail.contexts.length ? (
        <div className="bg-white border border-line rounded-xl3 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-ink-2 mb-1">No architecture yet</p>
          <p className="text-[13px] text-ink-3 mb-5 max-w-md mx-auto">
            Propose bounded contexts and the interfaces between them from the drafted stories.
          </p>
          {canEdit ? (
            <button
              type="button"
              onClick={() => void draftArchitecture()}
              className="rounded-xl2 px-4 py-2.5 text-sm font-bold bg-bosch-red text-white"
            >
              Propose the architecture
            </button>
          ) : (
            <p className="text-[12px] text-ink-3">Only editors can propose architecture.</p>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[12px] text-ink-3">
              {detail.contexts.length} context{detail.contexts.length === 1 ? '' : 's'} ·{' '}
              {detail.interfaces.length} interface{detail.interfaces.length === 1 ? '' : 's'}
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => void draftArchitecture()}
                className="rounded-xl2 px-3 py-1.5 text-xs font-bold border border-line text-ink-2 hover:border-bosch-red"
              >
                Propose again
              </button>
            )}
          </div>

          <div className="space-y-4">
            {detail.contexts.map((ctx, i) => (
              <div
                key={ctx.id}
                className="bg-white border border-line rounded-xl3 overflow-hidden"
              >
                <div className="px-5 py-3 border-b border-line flex items-start gap-3">
                  <span className="text-[11px] font-bold text-ink-3 shrink-0 mt-0.5">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-extrabold text-ink-1">{ctx.name}</h2>
                    {ctx.description ? (
                      <p className="text-[13px] text-ink-2 mt-1 leading-relaxed">
                        {ctx.description}
                      </p>
                    ) : null}
                    {ctx.depends_on.length > 0 && (
                      <p className="text-[11px] text-ink-3 mt-2">
                        Depends on: {ctx.depends_on.join(', ')}
                      </p>
                    )}
                  </div>
                </div>
                <div className="px-5 py-4">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-2">
                    Interfaces
                  </div>
                  <ul className="space-y-2">
                    {detail.interfaces
                      .filter(
                        (iface) =>
                          iface.context.toLowerCase() === ctx.name.toLowerCase() ||
                          iface.description.toLowerCase().includes(ctx.name.toLowerCase()),
                      )
                      .map((iface) => (
                        <li
                          key={iface.id}
                          className="flex gap-2.5 text-[13px] text-ink-2 border border-line rounded-xl2 px-3 py-2.5 bg-surface-1"
                        >
                          <span className="text-[10px] font-bold uppercase tracking-wide text-bosch-muted shrink-0 mt-0.5">
                            {iface.protocol}
                          </span>
                          <div className="min-w-0">
                            <div className="font-semibold text-ink-1">{iface.name}</div>
                            {iface.description ? (
                              <div className="text-[12px] text-ink-3 mt-0.5">
                                {iface.description}
                              </div>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    {!detail.interfaces.some(
                      (iface) =>
                        iface.context.toLowerCase() === ctx.name.toLowerCase() ||
                        iface.description.toLowerCase().includes(ctx.name.toLowerCase()),
                    ) && (
                      <li className="text-[12px] text-ink-3">No interfaces linked yet.</li>
                    )}
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
