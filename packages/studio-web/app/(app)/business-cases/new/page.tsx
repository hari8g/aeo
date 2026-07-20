'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

function NewBusinessCaseInner() {
  const router = useRouter()
  const params = useSearchParams()
  const painPointId = Number(params.get('painPointId') ?? '')
  const label = params.get('label') ?? 'Customer problem'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function writeCase() {
    if (!Number.isFinite(painPointId) || painPointId <= 0) {
      setError('Missing pain point. Go back to Pain Points and try again.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/business-cases/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ painPointIds: [painPointId] }),
      })
      const data = (await res.json()) as { featureId?: number; error?: string }
      if (!res.ok || !data.featureId) {
        throw new Error(data.error || 'Could not draft the business case')
      }
      router.push(`/business-cases/${data.featureId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not draft the business case')
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <>
        <div className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-bosch-muted mb-1">
            Decide
          </p>
          <h1 className="text-[22px] font-extrabold tracking-tight mb-1">Drafting the case…</h1>
          <p className="text-ink-3 text-[13.5px]">
            This usually takes about 10 seconds. We&apos;re shaping the problem, who&apos;s
            affected, and what we know from feedback.
          </p>
        </div>
        <div className="space-y-3">
          <div className="bg-white border border-line rounded-xl3 h-24 animate-pulse" />
          <div className="bg-white border border-line rounded-xl3 p-6 space-y-4">
            <div className="h-4 w-24 bg-surface-2 rounded animate-pulse" />
            <div className="h-16 bg-surface-2 rounded-xl2 animate-pulse" />
            <div className="h-4 w-32 bg-surface-2 rounded animate-pulse" />
            <div className="h-10 bg-surface-2 rounded-xl2 animate-pulse" />
            <div className="h-4 w-28 bg-surface-2 rounded animate-pulse" />
            <div className="h-14 bg-surface-2 rounded-xl2 animate-pulse" />
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-bosch-muted mb-1">
          Decide
        </p>
        <h1 className="text-[22px] font-extrabold tracking-tight mb-1">New business case</h1>
        <p className="text-ink-3 text-[13.5px]">
          Review the customer problem, then ask the system to draft a structured case.
        </p>
      </div>

      <div className="bg-white border border-line rounded-xl3 overflow-hidden flex mb-6">
        <div className="w-1.5 bg-bosch-red" />
        <div className="flex-1 px-5 py-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-bosch-muted mb-1">
            Starting from this pain point
          </div>
          <div className="text-[15px] font-extrabold text-ink-1">{label}</div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl2 border border-pink-bd bg-pink-bg px-4 py-3 text-sm text-bosch-red font-semibold">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={() => void writeCase()}
        className="rounded-xl2 px-5 py-3 text-sm font-bold bg-bosch-red text-white hover:opacity-90"
      >
        Write the business case
      </button>
    </>
  )
}

export default function NewBusinessCasePage() {
  return (
    <Suspense
      fallback={
        <div className="bg-white border border-line rounded-xl3 h-40 animate-pulse" />
      }
    >
      <NewBusinessCaseInner />
    </Suspense>
  )
}
