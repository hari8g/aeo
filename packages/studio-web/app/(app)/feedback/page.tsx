'use client'

import { useCallback, useState } from 'react'
import ConnectorCards from '@/components/ConnectorCards'

type Mode = 'choose' | 'upload' | 'paste'

export default function FeedbackPage() {
  const [mode, setMode] = useState<Mode>('choose')
  const [dragging, setDragging] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  const ingestFile = useCallback(async (file: File) => {
    setBusy(true)
    setToast('')
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/ingest/file', { method: 'POST', body })
      const data = (await res.json()) as {
        ingested?: number
        painPointsFound?: number
        error?: string
      }
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setToast(
        `${data.ingested} pieces of feedback added — ${data.painPointsFound} new problems found.`,
      )
      setMode('choose')
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }, [])

  async function ingestText() {
    setBusy(true)
    setToast('')
    try {
      const res = await fetch('/api/ingest/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = (await res.json()) as {
        ingested?: number
        painPointsFound?: number
        error?: string
      }
      if (!res.ok) throw new Error(data.error || 'Failed')
      setToast(
        `${data.ingested} pieces of feedback added — ${data.painPointsFound} new problems found.`,
      )
      setText('')
      setMode('choose')
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[22px] font-extrabold tracking-tight mb-1">Add Feedback</h1>
        <p className="text-ink-3 text-[13.5px]">
          Bring in what customers are saying so we can find the problems that matter.
        </p>
      </div>

      {toast && (
        <div className="mb-4 rounded-xl2 border border-ok-bd bg-ok-bg text-ok px-4 py-3 text-sm font-semibold">
          {toast}
        </div>
      )}

      {mode === 'choose' && (
        <div className="grid grid-cols-2 gap-3.5">
          {[
            {
              id: 'upload' as const,
              title: 'Upload a file',
              desc: 'CSV with date, cohort, type, text columns',
            },
            { id: 'paste' as const, title: 'Paste text', desc: 'One comment per line' },
            {
              id: 'tool' as const,
              title: 'Connect a tool',
              desc: 'Zendesk, Intercom, or Slack',
            },
            {
              id: 'email' as const,
              title: 'Forward an email',
              desc: 'Coming soon — use paste for now',
            },
          ].map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => {
                if (card.id === 'upload' || card.id === 'paste') setMode(card.id)
                if (card.id === 'tool') {
                  document.getElementById('connectors')?.scrollIntoView({ behavior: 'smooth' })
                }
              }}
              className="text-left bg-white border border-line rounded-xl3 px-5 py-5 hover:border-pink-bd hover:bg-pink-bg transition-colors"
            >
              <div className="text-[15px] font-extrabold mb-1">{card.title}</div>
              <div className="text-[12.5px] text-ink-3">{card.desc}</div>
            </button>
          ))}
        </div>
      )}

      {mode === 'upload' && (
        <div className="bg-white border border-line rounded-xl3 p-6">
          <button type="button" className="text-sm text-ink-2 mb-4" onClick={() => setMode('choose')}>
            ← Back
          </button>
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              const file = e.dataTransfer.files?.[0]
              if (file) void ingestFile(file)
            }}
            className={`border-2 border-dashed rounded-xl3 px-6 py-16 text-center ${
              dragging ? 'border-pink bg-pink-bg' : 'border-line-2 bg-surface-1'
            }`}
          >
            <p className="font-bold text-ink-1 mb-2">Drag a CSV here</p>
            <p className="text-sm text-ink-3 mb-4">or choose a file from your computer</p>
            <label className="inline-block bg-pink text-white rounded-xl2 px-4 py-2 text-sm font-bold cursor-pointer">
              {busy ? 'Uploading…' : 'Choose file'}
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void ingestFile(file)
                }}
              />
            </label>
          </div>
        </div>
      )}

      {mode === 'paste' && (
        <div className="bg-white border border-line rounded-xl3 p-6">
          <button type="button" className="text-sm text-ink-2 mb-4" onClick={() => setMode('choose')}>
            ← Back
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder="Paste customer comments, one per line…"
            className="w-full border border-line rounded-xl2 p-3 text-sm outline-none focus:border-pink mb-3"
          />
          <button
            type="button"
            disabled={busy || !text.trim()}
            onClick={() => void ingestText()}
            className="bg-pink text-white rounded-xl2 px-4 py-2.5 text-sm font-bold disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Add feedback'}
          </button>
        </div>
      )}

      <div className="mt-10">
        <h2 className="text-[16px] font-extrabold mb-3">Connect a tool</h2>
        <ConnectorCards />
      </div>
    </>
  )
}
