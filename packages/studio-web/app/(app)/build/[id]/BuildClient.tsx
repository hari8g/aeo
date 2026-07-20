'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type Note = {
  id: number
  title: string
  description: string
  risk: string
  files: string[]
}

type Detail = {
  feature_id: number
  title: string
  admitted: boolean
  has_architecture: boolean
  status: string
  notes: Note[]
  files: Array<{ id: number; path: string; label: string }>
}

function riskChip(risk: string) {
  const r = risk.toLowerCase()
  if (r === 'high') return 'bg-pink-bg text-pink border-pink-bd'
  if (r === 'medium') return 'bg-amber-bg text-amber border-amber-bd'
  return 'bg-ok-bg text-ok border-ok-bd'
}

export default function BuildClient({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/build/${id}`)
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

  async function recordImplementation() {
    setRecording(true)
    setError('')
    try {
      const res = await fetch(`/api/build/${id}/record`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Could not record implementation')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record implementation')
    } finally {
      setRecording(false)
    }
  }

  if (loading || recording) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8">
        <p className="text-sm font-semibold text-ink-2 mb-1">
          {recording ? 'Recording implementation…' : 'Loading…'}
        </p>
        <p className="text-[13px] text-ink-3">Capturing the changeset for this case.</p>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-ink-2">{error || 'Case not found'}</p>
        <Link href="/build" className="inline-block mt-3 text-xs font-bold text-bosch-red">
          ← Back to Implementation
        </Link>
      </div>
    )
  }

  if (!detail.admitted) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Not admitted yet</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Implementation is recorded only after Portfolio Review admits the case.
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

  if (!detail.has_architecture) {
    return (
      <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-5">
        <div className="font-bold text-amber text-sm mb-2">Architecture first</div>
        <p className="text-[13px] text-ink-2 mb-3">
          Propose architecture before recording what engineering built.
        </p>
        <Link
          href={`/architecture/${id}`}
          className="inline-block rounded-xl2 px-4 py-2 text-xs font-bold bg-bosch-red text-white"
        >
          Open Architecture →
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

      {!detail.notes.length ? (
        <div className="bg-white border border-line rounded-xl3 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-ink-2 mb-1">No implementation yet</p>
          <p className="text-[13px] text-ink-3 mb-5 max-w-md mx-auto">
            Record the engineering changeset — a short note, risk level, and the files that
            landed.
          </p>
          {canEdit ? (
            <button
              type="button"
              onClick={() => void recordImplementation()}
              className="rounded-xl2 px-4 py-2.5 text-sm font-bold bg-bosch-red text-white"
            >
              Record the implementation
            </button>
          ) : (
            <p className="text-[12px] text-ink-3">Only editors can record implementation.</p>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[12px] text-ink-3">
              {detail.notes.length} note{detail.notes.length === 1 ? '' : 's'} ·{' '}
              {detail.files.length} file{detail.files.length === 1 ? '' : 's'}
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => void recordImplementation()}
                className="rounded-xl2 px-3 py-1.5 text-xs font-bold border border-line text-ink-2 hover:border-bosch-red"
              >
                Record again
              </button>
            )}
          </div>

          <div className="space-y-4">
            {detail.notes.map((note) => (
              <div
                key={note.id}
                className="bg-white border border-line rounded-xl3 overflow-hidden"
              >
                <div className="px-5 py-3 border-b border-line flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-extrabold text-ink-1">{note.title}</h2>
                    {note.description ? (
                      <p className="text-[13px] text-ink-2 mt-1 leading-relaxed">
                        {note.description}
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={`shrink-0 text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 ${riskChip(note.risk)}`}
                  >
                    {note.risk} risk
                  </span>
                </div>
                <div className="px-5 py-4">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-2">
                    Files touched
                  </div>
                  <ul className="space-y-1.5">
                    {(note.files.length ? note.files : detail.files.map((f) => f.path)).map(
                      (path) => (
                        <li
                          key={path}
                          className="text-[12px] font-mono text-ink-2 border border-line rounded-xl2 px-3 py-2 bg-surface-1"
                        >
                          {path}
                        </li>
                      ),
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
