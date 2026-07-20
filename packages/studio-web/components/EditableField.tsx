'use client'

import { useState } from 'react'

type Props = {
  label: string
  value: string
  onSave: (value: string) => Promise<void>
  multiline?: boolean
  canEdit?: boolean
}

export default function EditableField({
  label,
  value,
  onSave,
  multiline = false,
  canEdit = true,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true)
    setError('')
    try {
      await onSave(draft)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-bosch-muted mb-1.5">
        {label}
      </div>
      {!editing ? (
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => {
            setDraft(value)
            setEditing(true)
          }}
          className={`w-full text-left text-[14px] text-ink-1 leading-relaxed whitespace-pre-wrap rounded-xl2 px-3 py-2.5 border border-transparent ${
            canEdit ? 'hover:border-line hover:bg-surface-2 cursor-text' : 'cursor-default'
          }`}
        >
          {value || <span className="text-ink-3">Click to add…</span>}
        </button>
      ) : (
        <div className="space-y-2">
          {multiline ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              className="w-full border border-line rounded-xl2 px-3 py-2.5 text-sm outline-none focus:border-bosch-red"
              autoFocus
            />
          ) : (
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full border border-line rounded-xl2 px-3 py-2.5 text-sm outline-none focus:border-bosch-red"
              autoFocus
            />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="rounded-xl2 px-3.5 py-2 text-xs font-bold bg-bosch-red text-white disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setDraft(value)
                setEditing(false)
                setError('')
              }}
              className="rounded-xl2 px-3.5 py-2 text-xs font-bold border border-line text-ink-2 bg-white"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-xs text-bosch-red font-semibold">{error}</p>}
        </div>
      )}
    </div>
  )
}

export function ReadOnlyField({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-bosch-muted mb-1.5">
        {label}
      </div>
      <div className="text-[14px] text-ink-1 leading-relaxed whitespace-pre-wrap rounded-xl2 px-3 py-2.5 bg-surface-2 border border-line">
        {value || '—'}
      </div>
      {hint && <p className="text-[11px] text-ink-3 mt-1.5">{hint}</p>}
    </div>
  )
}
