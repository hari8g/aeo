'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import EditableField from '@/components/EditableField'
import SegmentCard from '@/components/SegmentCard'

type Segment = {
  name: string
  size: string
  fit: string
  cac: string
  ltv: string
}

type GtmData = {
  positioning?: string
  segments?: Segment[]
  go_to_market?: string
  competitive_differentiation?: string
}

type Detail = {
  feature_id: number
  title: string
  has_value: boolean
  projection: { id: number; data: GtmData } | null
}

export default function GtmClient({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [planning, setPlanning] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/gtm/${id}`)
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

  async function planGtm() {
    setPlanning(true)
    setError('')
    try {
      const res = await fetch(`/api/gtm/${id}/plan`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Could not plan go-to-market')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not plan go-to-market')
    } finally {
      setPlanning(false)
    }
  }

  async function savePositioning(value: string) {
    const res = await fetch(`/api/gtm/${id}/positioning`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positioning: value }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error || 'Save failed')
    }
    setDetail((prev) =>
      prev?.projection
        ? {
            ...prev,
            projection: {
              ...prev.projection,
              data: { ...prev.projection.data, positioning: value },
            },
          }
        : prev,
    )
  }

  if (loading || planning) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8">
        <p className="text-sm font-semibold text-ink-2 mb-1">
          {planning ? 'Planning go-to-market…' : 'Loading…'}
        </p>
        <p className="text-[13px] text-ink-3 mb-5">
          {planning
            ? 'This takes about 10 seconds, using the value estimate you already have.'
            : 'Fetching the go-to-market plan.'}
        </p>
        <div className="h-16 bg-surface-2 rounded-xl2 animate-pulse mb-4" />
        <div className="h-28 bg-surface-2 rounded-xl2 animate-pulse" />
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-6 py-10 text-center text-sm text-ink-3">
        {error || 'Not found.'}
      </div>
    )
  }

  if (!detail.has_value) {
    return (
      <div className="bg-white border border-line rounded-xl3 text-center py-16 px-6">
        <div className="text-4xl mb-3">🔒</div>
        <h3 className="font-extrabold text-base text-ink-1 mb-2">We need a value estimate first</h3>
        <p className="text-ink-3 text-sm mb-5 max-w-sm mx-auto">
          Go-to-market planning builds on top of the business value assessment — head to{' '}
          <b>Business Value</b> and estimate that first.
        </p>
        <Link
          href={`/business-cases/${id}/value`}
          className="inline-block rounded-xl2 px-4 py-2.5 text-xs font-bold border border-line bg-white text-ink-2"
        >
          Go to Business Value →
        </Link>
      </div>
    )
  }

  if (!detail.projection) {
    return (
      <div className="bg-white border border-line rounded-xl3 text-center py-16 px-6">
        <div className="text-4xl mb-3">🗺️</div>
        <h3 className="font-extrabold text-base text-ink-1 mb-2">
          Let&apos;s figure out who this is for
        </h3>
        <p className="text-ink-3 text-sm mb-5">
          This takes about 10 seconds, using the value estimate you already have.
        </p>
        {error && <p className="text-xs text-bosch-red font-semibold mb-3">{error}</p>}
        {canEdit ? (
          <button
            type="button"
            onClick={() => void planGtm()}
            className="rounded-xl2 px-5 py-3 text-sm font-bold bg-bosch-red text-white"
          >
            Plan the go-to-market
          </button>
        ) : (
          <p className="text-sm text-ink-3">Ask an editor or admin to plan go-to-market.</p>
        )}
      </div>
    )
  }

  const data = detail.projection.data
  const segments = data.segments ?? []

  return (
    <>
      {error && (
        <div className="mb-4 rounded-xl2 border border-pink-bd bg-pink-bg px-4 py-3 text-sm text-bosch-red font-semibold">
          {error}
        </div>
      )}

      <div className="bg-white border border-line rounded-xl3 overflow-hidden">
        <div className="px-5 py-4 border-b border-line">
          <h2 className="text-[16px] font-extrabold text-ink-1 mb-3">How we&apos;d bring this to market</h2>
          <EditableField
            label="Positioning"
            value={data.positioning ?? ''}
            multiline
            canEdit={canEdit}
            onSave={(v) => savePositioning(v)}
          />
        </div>

        <div className="px-5 py-5 space-y-6">
          <div>
            <h4 className="text-sm font-bold text-ink-1 mb-3">Who this is for</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {segments.map((seg, i) => (
                <SegmentCard key={i} segment={seg} />
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-bold text-ink-1 mb-2">How we&apos;d reach them</h4>
            <p className="text-[13px] text-ink-2 leading-relaxed">{data.go_to_market}</p>
          </div>

          <div>
            <h4 className="text-sm font-bold text-ink-1 mb-2">What makes this different</h4>
            <p className="text-[13px] text-ink-2 leading-relaxed">
              {data.competitive_differentiation}
            </p>
          </div>

          <div className="pt-2 border-t border-line">
            <Link
              href={`/business-cases/${id}`}
              className="text-xs font-bold text-bosch-red hover:underline"
            >
              ← Back to business case
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}
