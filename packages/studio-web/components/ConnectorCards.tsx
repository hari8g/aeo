'use client'

import { useEffect, useState } from 'react'

const ITEMS = [
  { id: 'zendesk', name: 'Zendesk', desc: 'Support tickets and macros' },
  { id: 'intercom', name: 'Intercom', desc: 'Chat transcripts and tags' },
  { id: 'slack', name: 'Slack', desc: 'Shared customer channels' },
]

export default function ConnectorCards() {
  const [status, setStatus] = useState<Record<string, string | null>>({
    zendesk: null,
    intercom: null,
    slack: null,
  })
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/connectors')
      .then((r) => r.json())
      .then((rows: { connector: string; connected_at: string | null }[]) => {
        const map: Record<string, string | null> = {
          zendesk: null,
          intercom: null,
          slack: null,
        }
        for (const r of rows) map[r.connector] = r.connected_at
        setStatus(map)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  async function connect(connector: string) {
    const res = await fetch(`/api/connectors/${connector}/connect`, { method: 'POST' })
    if (res.ok) {
      setStatus((prev) => ({ ...prev, [connector]: new Date().toISOString() }))
    }
  }

  return (
    <div id="connectors" className="bg-white border border-line rounded-xl3 divide-y divide-line">
      {ITEMS.map((item) => {
        const connected = !!status[item.id]
        return (
          <div key={item.id} className="flex items-center justify-between px-5 py-4">
            <div>
              <div className="text-sm font-bold">{item.name}</div>
              <div className="text-[12px] text-ink-3">{item.desc}</div>
            </div>
            {connected ? (
              <span className="text-xs font-bold text-ok bg-ok-bg border border-ok-bd rounded-full px-3 py-1">
                Connected
              </span>
            ) : (
              <button
                type="button"
                disabled={!loaded}
                onClick={() => void connect(item.id)}
                className="text-xs font-bold text-pink border border-pink-bd bg-pink-bg rounded-full px-3 py-1.5"
              >
                Connect
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
