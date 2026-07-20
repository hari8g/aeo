'use client'

import { useEffect, useState } from 'react'

type Member = {
  id: string
  email: string
  name: string
  role: 'admin' | 'editor' | 'viewer'
  last_active_at: string | null
}

type SsoRow = { provider: string; client_id: string | null; connected_at: string | null }

type Approver = { user_id: string; title: string; name: string; email: string }

const ROLE_STYLE = {
  admin: 'bg-pink-bg text-pink border-pink-bd',
  editor: 'bg-blue-bg text-blue border-blue-bd',
  viewer: 'bg-surface-1 text-ink-2 border-line',
}

export default function AccessPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [sso, setSso] = useState<SsoRow[]>([])
  const [requireSso, setRequireSso] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('editor')
  const [inviteMsg, setInviteMsg] = useState('')
  const [ssoForm, setSsoForm] = useState<{ provider: string; clientId: string; clientSecret: string } | null>(
    null,
  )
  const [approvers, setApprovers] = useState<Approver[]>([])
  const [approverUserId, setApproverUserId] = useState('')
  const [approverTitle, setApproverTitle] = useState('')
  const [approverMsg, setApproverMsg] = useState('')

  async function reload() {
    const [m, s, settings, a] = await Promise.all([
      fetch('/api/team/members').then((r) => r.json()),
      fetch('/api/sso').then((r) => r.json()),
      fetch('/api/settings').then((r) => r.json()),
      fetch('/api/team/approvers').then((r) => r.json()),
    ])
    setMembers(Array.isArray(m) ? m : [])
    setSso(Array.isArray(s) ? s : [])
    setRequireSso(!!settings?.require_sso)
    setApprovers(Array.isArray(a) ? a : [])
  }

  useEffect(() => {
    void reload()
  }, [])

  const connectedCount = sso.filter((x) => x.connected_at).length

  async function invite() {
    setInviteMsg('')
    const res = await fetch('/api/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    })
    const data = await res.json()
    if (res.ok) {
      setInviteMsg(`Invite sent to ${email}`)
      setEmail('')
    } else {
      setInviteMsg(data.error || 'Invite failed')
    }
  }

  async function changeRole(id: string, next: string) {
    await fetch(`/api/team/members/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: next }),
    })
    void reload()
  }

  async function removeMember(id: string, name: string) {
    if (!confirm(`Remove ${name} from this workspace?`)) return
    await fetch(`/api/team/members/${id}`, { method: 'DELETE' })
    void reload()
  }

  async function addApprover() {
    setApproverMsg('')
    if (!approverUserId || !approverTitle.trim()) {
      setApproverMsg('Select a member and enter a title')
      return
    }
    const res = await fetch('/api/team/approvers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: approverUserId, title: approverTitle.trim() }),
    })
    if (res.ok) {
      setApproverUserId('')
      setApproverTitle('')
      setApproverMsg('Approver added')
      void reload()
    } else {
      const data = await res.json().catch(() => ({}))
      setApproverMsg((data as { error?: string }).error || 'Could not add approver')
    }
  }

  async function removeApprover(userId: string, name: string) {
    if (!confirm(`Remove ${name} as a portfolio approver?`)) return
    await fetch(`/api/team/approvers/${userId}`, { method: 'DELETE' })
    void reload()
  }

  async function connectSso() {
    if (!ssoForm) return
    await fetch(`/api/sso/${ssoForm.provider}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: ssoForm.clientId,
        clientSecret: ssoForm.clientSecret,
      }),
    })
    setSsoForm(null)
    void reload()
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[22px] font-extrabold tracking-tight mb-1">Team & Access</h1>
        <p className="text-ink-3 text-[13.5px]">Invite teammates and control who can change settings.</p>
      </div>

      <section className="mb-8">
        <h2 className="text-[15px] font-extrabold mb-3">Invite someone</h2>
        <div className="bg-white border border-line rounded-xl3 p-4 flex flex-wrap gap-2 items-end">
          <label className="flex-1 min-w-[200px]">
            <span className="text-xs font-semibold text-ink-2">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              className="mt-1 w-full border border-line rounded-xl2 px-3 py-2 text-sm"
            />
          </label>
          <label>
            <span className="text-xs font-semibold text-ink-2">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 block border border-line rounded-xl2 px-3 py-2 text-sm font-semibold"
            >
              <option value="admin">Admin</option>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void invite()}
            className="bg-pink text-white rounded-xl2 px-4 py-2 text-sm font-bold"
          >
            Send invite
          </button>
        </div>
        {inviteMsg && <p className="text-sm text-ink-2 mt-2">{inviteMsg}</p>}
      </section>

      <section className="mb-8">
        <h2 className="text-[15px] font-extrabold mb-3">Members</h2>
        <div className="bg-white border border-line rounded-xl3 divide-y divide-line">
          {members.map((m) => (
            <div key={m.id} className="px-5 py-3.5 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-pink text-white text-xs font-bold flex items-center justify-center">
                {m.name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold">{m.name}</div>
                <div className="text-[12px] text-ink-3">{m.email}</div>
              </div>
              <span
                className={`text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 ${ROLE_STYLE[m.role]}`}
              >
                {m.role}
              </span>
              <div className="text-[11px] text-ink-3 w-28 text-right">
                {m.last_active_at
                  ? new Date(m.last_active_at).toLocaleDateString()
                  : 'Never'}
              </div>
              <details className="relative">
                <summary className="list-none cursor-pointer text-xs font-bold text-ink-2 border border-line rounded-xl2 px-2.5 py-1.5">
                  Manage
                </summary>
                <div className="absolute right-0 mt-1 bg-white border border-line rounded-xl2 shadow-none z-10 min-w-[140px] py-1">
                  {(['admin', 'editor', 'viewer'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      className="block w-full text-left px-3 py-1.5 text-xs font-semibold hover:bg-surface-1 capitalize"
                      onClick={() => void changeRole(m.id, r)}
                    >
                      Make {r}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="block w-full text-left px-3 py-1.5 text-xs font-semibold text-pink hover:bg-pink-bg"
                    onClick={() => void removeMember(m.id, m.name)}
                  >
                    Remove
                  </button>
                </div>
              </details>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-[15px] font-extrabold mb-3">What each role can do</h2>
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              title: 'Admin',
              body: 'Manage team access, settings, and SSO. Can add feedback and start work on problems.',
            },
            {
              title: 'Editor',
              body: 'Add feedback and start work on problems. Cannot change settings or invite people.',
            },
            {
              title: 'Viewer',
              body: 'See the home dashboard and pain points. Cannot add feedback or change anything.',
            },
          ].map((card) => (
            <div key={card.title} className="bg-white border border-line rounded-xl3 px-4 py-4">
              <div className="text-sm font-extrabold mb-1.5">{card.title}</div>
              <p className="text-[12.5px] text-ink-3 leading-relaxed">{card.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-[15px] font-extrabold mb-3">Single sign-on</h2>
        <div className="bg-white border border-line rounded-xl3 divide-y divide-line">
          {[
            { id: 'google', name: 'Google Workspace', docs: 'https://console.cloud.google.com/' },
            { id: 'microsoft', name: 'Microsoft 365', docs: 'https://portal.azure.com/' },
            { id: 'okta', name: 'Okta', docs: 'https://developer.okta.com/' },
          ].map((p) => {
            const row = sso.find((x) => x.provider === p.id)
            const connected = !!row?.connected_at
            return (
              <div key={p.id} className="px-5 py-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold">{p.name}</div>
                  <a href={p.docs} target="_blank" rel="noreferrer" className="text-[11px] text-blue">
                    Setup docs
                  </a>
                </div>
                {connected ? (
                  <span className="text-xs font-bold text-ok bg-ok-bg border border-ok-bd rounded-full px-3 py-1">
                    Connected
                  </span>
                ) : (
                  <button
                    type="button"
                    className="text-xs font-bold text-pink border border-pink-bd bg-pink-bg rounded-full px-3 py-1.5"
                    onClick={() =>
                      setSsoForm({ provider: p.id, clientId: '', clientSecret: '' })
                    }
                  >
                    Connect
                  </button>
                )}
              </div>
            )
          })}
        </div>
        {ssoForm && (
          <div className="mt-3 bg-surface-1 border border-line rounded-xl3 p-4 space-y-2">
            <div className="text-sm font-bold capitalize">Connect {ssoForm.provider}</div>
            <input
              placeholder="Client ID"
              value={ssoForm.clientId}
              onChange={(e) => setSsoForm({ ...ssoForm, clientId: e.target.value })}
              className="w-full border border-line rounded-xl2 px-3 py-2 text-sm"
            />
            <input
              placeholder="Client secret"
              type="password"
              value={ssoForm.clientSecret}
              onChange={(e) => setSsoForm({ ...ssoForm, clientSecret: e.target.value })}
              className="w-full border border-line rounded-xl2 px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void connectSso()}
                className="bg-pink text-white rounded-xl2 px-3 py-2 text-xs font-bold"
              >
                Save connection
              </button>
              <button
                type="button"
                onClick={() => setSsoForm(null)}
                className="text-xs font-bold text-ink-2 px-3 py-2"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="mb-8 mt-8 pt-6 border-t border-line">
        <h2 className="text-[15px] font-extrabold mb-1">Portfolio approvers</h2>
        <p className="text-[12px] text-ink-3 mb-4">
          Who can record Admit / Defer / Reject decisions on Portfolio Review
        </p>
        <div className="bg-white border border-line rounded-xl3 p-4 flex flex-wrap gap-2 items-end mb-3">
          <label className="flex-1 min-w-[180px]">
            <span className="text-xs font-semibold text-ink-2">Team member</span>
            <select
              value={approverUserId}
              onChange={(e) => setApproverUserId(e.target.value)}
              className="mt-1 w-full border border-line rounded-xl2 px-3 py-2 text-sm font-semibold"
            >
              <option value="">Select a team member</option>
              {members
                .filter((m) => !approvers.some((a) => a.user_id === m.id))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.email})
                  </option>
                ))}
            </select>
          </label>
          <label className="min-w-[180px]">
            <span className="text-xs font-semibold text-ink-2">Title</span>
            <input
              value={approverTitle}
              onChange={(e) => setApproverTitle(e.target.value)}
              placeholder="e.g. VP Engineering"
              className="mt-1 w-full border border-line rounded-xl2 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => void addApprover()}
            className="bg-pink text-white rounded-xl2 px-4 py-2 text-sm font-bold"
          >
            Add as approver
          </button>
        </div>
        {approverMsg && <p className="text-sm text-ink-2 mb-3">{approverMsg}</p>}
        <div className="bg-white border border-line rounded-xl3 divide-y divide-line">
          {approvers.length === 0 ? (
            <div className="px-5 py-4 text-[13px] text-ink-3">No portfolio approvers yet.</div>
          ) : (
            approvers.map((a) => (
              <div key={a.user_id} className="px-5 py-3.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold">{a.name}</div>
                  <div className="text-[12px] text-ink-3">{a.email}</div>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 bg-blue-bg text-blue border-blue-bd">
                  {a.title}
                </span>
                <button
                  type="button"
                  className="text-xs font-bold text-pink border border-pink-bd bg-pink-bg rounded-xl2 px-2.5 py-1.5"
                  onClick={() => void removeApprover(a.user_id, a.name)}
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section>
        <div className="bg-white border border-line rounded-xl3 px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-bold">Require single sign-on for everyone</div>
            <div className="text-[12px] text-ink-3">
              {connectedCount < 1
                ? 'Connect at least one provider before turning this on.'
                : 'Password sign-in will be blocked.'}
            </div>
          </div>
          <button
            type="button"
            disabled={connectedCount < 1}
            title={
              connectedCount < 1
                ? 'Connect an SSO provider first'
                : 'Require SSO for all sign-ins'
            }
            onClick={() => {
              const next = !requireSso
              setRequireSso(next)
              void fetch('/api/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requireSso: next }),
              }).then((r) => {
                if (!r.ok) setRequireSso(!next)
              })
            }}
            className={`w-11 h-6 rounded-full relative transition-colors disabled:opacity-40 ${
              requireSso ? 'bg-pink' : 'bg-line-2'
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${
                requireSso ? 'left-5' : 'left-0.5'
              }`}
            />
          </button>
        </div>
      </section>
    </>
  )
}
