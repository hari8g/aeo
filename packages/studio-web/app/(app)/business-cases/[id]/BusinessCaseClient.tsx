'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import EditableField, { ReadOnlyField } from '@/components/EditableField'

type Brief = {
  title?: string
  problemStatement?: string
  customerSegment?: string
  evidenceSummary?: string
  isDuplicate?: boolean
  duplicateOf?: string | null
  recommendation?: string
  mergeDecision?: string | null
}

type CaseDetail = {
  feature_id: number
  title: string
  brief_id: number
  brief: Brief
  status: string
  duplicate_feature_id: number | null
  sent_for_sizing?: boolean
}

export default function BusinessCaseClient({
  id,
  canEdit,
}: {
  id: string
  canEdit: boolean
}) {
  const router = useRouter()
  const [item, setItem] = useState<CaseDetail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/business-cases/${id}`)
      const data = (await res.json()) as CaseDetail & { error?: string }
      if (!res.ok) throw new Error(data.error || 'Not found')
      setItem(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load business case')
      setItem(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function saveField(field: string, value: string) {
    const res = await fetch(`/api/business-cases/${id}/field`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field, value }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error || 'Save failed')
    }
    setItem((prev) =>
      prev
        ? {
            ...prev,
            title: field === 'title' ? value : prev.title,
            brief: { ...prev.brief, [field]: value },
          }
        : prev,
    )
  }

  async function dismissDuplicate() {
    setBusy('dismiss')
    try {
      const res = await fetch(`/api/business-cases/${id}/dismiss-duplicate`, { method: 'POST' })
      if (!res.ok) throw new Error('Could not update')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update')
    } finally {
      setBusy('')
    }
  }

  async function mergeDuplicate() {
    setBusy('merge')
    try {
      const res = await fetch(`/api/business-cases/${id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mergeIntoFeatureId: item?.duplicate_feature_id ?? undefined,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || 'Could not combine')
      }
      router.push('/business-cases')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not combine')
      setBusy('')
    }
  }

  async function sendForSizing() {
    setBusy('send')
    try {
      const res = await fetch(`/api/business-cases/${id}/send`, { method: 'POST' })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || 'Could not send')
      }
      await load()
      router.refresh()
      router.push(`/business-cases/${id}/value`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send')
    } finally {
      setBusy('')
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="bg-white border border-line rounded-xl3 h-20 animate-pulse" />
        <div className="bg-white border border-line rounded-xl3 h-72 animate-pulse" />
      </div>
    )
  }

  if (!item) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-6 py-10 text-center text-sm text-ink-3">
        {error || 'Business case not found.'}
      </div>
    )
  }

  const brief = item.brief
  const showDup = !!brief.isDuplicate && !brief.mergeDecision
  const sent =
    !!item.sent_for_sizing ||
    ['Sizing in progress', 'Awaiting decision', '✓ Admitted', '↩ Deferred', '✗ Rejected'].includes(
      item.status,
    )

  return (
    <>
      {error && (
        <div className="mb-4 rounded-xl2 border border-pink-bd bg-pink-bg px-4 py-3 text-sm text-bosch-red font-semibold">
          {error}
        </div>
      )}

      {showDup && (
        <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-4 mb-6">
          <div className="text-amber font-bold text-sm mb-2">⚠ This might already be in progress</div>
          <p className="text-ink-2 text-[13px] mb-3">
            This looks similar to an existing idea:{' '}
            <b>{brief.duplicateOf || 'an earlier business case'}</b>
          </p>
          {canEdit ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void dismissDuplicate()}
                className="rounded-xl2 px-3.5 py-2 text-xs font-bold border border-line bg-white text-ink-2"
              >
                {busy === 'dismiss' ? 'Updating…' : 'No, this is different'}
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void mergeDuplicate()}
                className="rounded-xl2 px-3.5 py-2 text-xs font-bold bg-bosch-red text-white"
              >
                {busy === 'merge' ? 'Combining…' : 'Yes, combine these →'}
              </button>
            </div>
          ) : (
            <p className="text-xs text-ink-3">Ask an editor or admin to resolve this before sizing.</p>
          )}
        </div>
      )}

      <div className="bg-white border border-line rounded-xl3 overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between gap-3">
          <h2 className="text-[16px] font-extrabold text-ink-1">Case details</h2>
          <span className="text-[10px] font-bold uppercase tracking-wide bg-surface-2 text-ink-2 border border-line rounded-full px-2 py-0.5">
            {item.status}
          </span>
        </div>
        <div className="px-5 py-5 space-y-5">
          <EditableField
            label="Problem"
            value={brief.problemStatement ?? ''}
            multiline
            canEdit={canEdit}
            onSave={(v) => saveField('problemStatement', v)}
          />
          <EditableField
            label="Who's affected"
            value={brief.customerSegment ?? ''}
            multiline
            canEdit={canEdit}
            onSave={(v) => saveField('customerSegment', v)}
          />
          <ReadOnlyField
            label="What we know"
            value={brief.evidenceSummary ?? ''}
            hint="Pulled directly from customer feedback — not editable"
          />
          <ReadOnlyField
            label="Our take"
            value={brief.recommendation ?? ''}
            hint="Suggested by the system based on similar past cases"
          />
        </div>
      </div>

      {canEdit ? (
        <button
          type="button"
          disabled={!!busy || sent || showDup}
          onClick={() => void sendForSizing()}
          className="rounded-xl2 px-5 py-3 text-sm font-bold bg-bosch-red text-white disabled:opacity-50"
        >
          {sent
            ? 'Sent for business case sizing'
            : busy === 'send'
              ? 'Sending…'
              : 'Send for business case sizing →'}
        </button>
      ) : (
        <p className="text-sm text-ink-3">
          You can view this business case. Ask an editor or admin to edit or send it for business
          case sizing.
        </p>
      )}
    </>
  )
}
