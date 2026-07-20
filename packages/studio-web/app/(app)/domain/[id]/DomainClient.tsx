'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type Item = { id: number; name: string; description: string; target?: string }

type Detail = {
  feature_id: number
  title: string
  admitted: boolean
  has_stories: boolean
  status: string
  concepts: Item[]
  kpis: Item[]
  regulations: Item[]
  rules: Item[]
}

function Section({
  title,
  items,
  empty,
}: {
  title: string
  items: Item[]
  empty: string
}) {
  return (
    <div className="bg-white border border-line rounded-xl3 overflow-hidden">
      <div className="px-5 py-3 border-b border-line">
        <h2 className="text-[13px] font-extrabold text-ink-1">{title}</h2>
      </div>
      <div className="px-5 py-4">
        {!items.length ? (
          <p className="text-[13px] text-ink-3">{empty}</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="border border-line rounded-xl2 px-3 py-2.5 bg-surface-1"
              >
                <div className="font-semibold text-[13px] text-ink-1">{item.name}</div>
                {item.description ? (
                  <p className="text-[12px] text-ink-3 mt-0.5 leading-relaxed">{item.description}</p>
                ) : null}
                {item.target ? (
                  <p className="text-[11px] font-bold text-bosch-muted mt-1">Target: {item.target}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default function DomainClient({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [drafting, setDrafting] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/domain/${id}`)
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

  async function draftDomain() {
    setDrafting(true)
    setError('')
    try {
      const res = await fetch(`/api/domain/${id}/draft`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Could not draft domain model')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not draft domain model')
    } finally {
      setDrafting(false)
    }
  }

  if (loading || drafting) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8">
        <p className="text-sm font-semibold text-ink-2 mb-1">
          {drafting ? 'Drafting domain model…' : 'Loading…'}
        </p>
        <p className="text-[13px] text-ink-3">
          Pulling concepts, KPIs, and rules from the admitted case.
        </p>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-ink-2">{error || 'Case not found'}</p>
        <Link href="/domain" className="inline-block mt-3 text-xs font-bold text-bosch-red">
          ← Back to Domain Model
        </Link>
      </div>
    )
  }

  if (!detail.admitted) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Not admitted yet</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Domain modeling starts after Portfolio Review admits the case.
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
          Draft user stories before modeling the domain — they keep the language tied to what
          we&apos;re building.
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

  const total =
    detail.concepts.length +
    detail.kpis.length +
    detail.regulations.length +
    detail.rules.length

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl2 border border-pink-bd bg-pink-bg text-pink px-4 py-3 text-sm font-semibold">
          {error}
        </div>
      )}

      {!total ? (
        <div className="bg-white border border-line rounded-xl3 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-ink-2 mb-1">No domain model yet</p>
          <p className="text-[13px] text-ink-3 mb-5 max-w-md mx-auto">
            Extract the shared concepts, KPIs, regulations, and business rules that define how
            this product works.
          </p>
          {canEdit ? (
            <button
              type="button"
              onClick={() => void draftDomain()}
              className="rounded-xl2 px-4 py-2.5 text-sm font-bold bg-bosch-red text-white"
            >
              Draft the domain model
            </button>
          ) : (
            <p className="text-[12px] text-ink-3">Only editors can draft the domain model.</p>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[12px] text-ink-3">
              {detail.concepts.length} concepts · {detail.kpis.length} KPIs ·{' '}
              {detail.rules.length} rules
              {detail.regulations.length ? ` · ${detail.regulations.length} regulations` : ''}
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => void draftDomain()}
                className="rounded-xl2 px-3 py-1.5 text-xs font-bold border border-line text-ink-2 hover:border-bosch-red"
              >
                Draft again
              </button>
            )}
          </div>

          <div className="grid gap-4">
            <Section title="Concepts" items={detail.concepts} empty="No concepts yet." />
            <Section title="KPIs" items={detail.kpis} empty="No KPIs yet." />
            <Section title="Business rules" items={detail.rules} empty="No business rules yet." />
            {detail.regulations.length > 0 && (
              <Section
                title="Regulations"
                items={detail.regulations}
                empty="No regulations yet."
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
