'use client'

import { useEffect, useState } from 'react'

type Settings = {
  notify_big_problems: boolean
  weekly_summary_email: boolean
  auto_group_feedback: boolean
  summary_language: string
  retention_months: number
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d: Settings) => setSettings(d))
      .catch(() => setError('Could not load settings'))
  }, [])

  async function patch(partial: Record<string, unknown>, revert: () => void) {
    setError('')
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    })
    if (!res.ok) {
      revert()
      setError('Could not save — try again')
    }
  }

  if (!settings) {
    return <p className="text-ink-3 text-sm">{error || 'Loading settings…'}</p>
  }

  const rows: {
    key: keyof Settings
    apiKey: string
    label: string
    desc: string
    type: 'toggle' | 'select'
    options?: { value: string | number; label: string }[]
  }[] = [
    {
      key: 'notify_big_problems',
      apiKey: 'notifyBigProblems',
      label: 'Notify me about big problems',
      desc: 'Email when a problem suddenly grows, or a portfolio packet needs a decision',
      type: 'toggle',
    },
    {
      key: 'weekly_summary_email',
      apiKey: 'weeklySummaryEmail',
      label: 'Weekly summary email',
      desc: 'A short digest every Monday morning',
      type: 'toggle',
    },
    {
      key: 'auto_group_feedback',
      apiKey: 'autoGroupFeedback',
      label: 'Automatically group similar feedback',
      desc: 'Combine related comments into one problem',
      type: 'toggle',
    },
    {
      key: 'summary_language',
      apiKey: 'summaryLanguage',
      label: 'Summary language',
      desc: 'Language used in digests and problem titles',
      type: 'select',
      options: [
        { value: 'en', label: 'English' },
        { value: 'es', label: 'Spanish' },
        { value: 'fr', label: 'French' },
      ],
    },
    {
      key: 'retention_months',
      apiKey: 'retentionMonths',
      label: 'Keep feedback for',
      desc: 'Older feedback is removed after this period',
      type: 'select',
      options: [
        { value: 6, label: '6 months' },
        { value: 12, label: '12 months' },
        { value: 24, label: '24 months' },
      ],
    },
  ]

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[22px] font-extrabold tracking-tight mb-1">Settings</h1>
        <p className="text-ink-3 text-[13.5px]">
          Workspace preferences for Bosch MPS Customer Insights.
        </p>
      </div>
      {error && (
        <div className="mb-3 text-sm font-semibold text-pink bg-pink-bg border border-pink-bd rounded-xl2 px-3 py-2">
          {error}
        </div>
      )}
      <div className="bg-white border border-line rounded-xl3 divide-y divide-line">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4 px-5 py-4">
            <div>
              <div className="text-sm font-bold">{row.label}</div>
              <div className="text-[12px] text-ink-3">{row.desc}</div>
            </div>
            {row.type === 'toggle' ? (
              <button
                type="button"
                aria-pressed={!!settings[row.key]}
                onClick={() => {
                  const prev = settings[row.key] as boolean
                  const next = !prev
                  setSettings({ ...settings, [row.key]: next })
                  void patch({ [row.apiKey]: next }, () =>
                    setSettings({ ...settings, [row.key]: prev }),
                  )
                }}
                className={`w-11 h-6 rounded-full relative transition-colors ${
                  settings[row.key] ? 'bg-pink' : 'bg-line-2'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${
                    settings[row.key] ? 'left-5' : 'left-0.5'
                  }`}
                />
              </button>
            ) : (
              <select
                value={String(settings[row.key])}
                onChange={(e) => {
                  const prev = settings[row.key]
                  const raw = e.target.value
                  const next = row.key === 'retention_months' ? Number(raw) : raw
                  setSettings({ ...settings, [row.key]: next })
                  void patch({ [row.apiKey]: next }, () =>
                    setSettings({ ...settings, [row.key]: prev }),
                  )
                }}
                className="border border-line rounded-xl2 px-3 py-2 text-sm font-semibold"
              >
                {row.options!.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
