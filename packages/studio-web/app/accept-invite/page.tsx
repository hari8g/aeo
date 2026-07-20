'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'

function AcceptInviteForm() {
  const params = useSearchParams()
  const token = params.get('token') ?? ''
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) return
    fetch(`/api/team/invite?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('Invalid or expired invite')
        return r.json()
      })
      .then((d: { email: string; role: string }) => {
        setEmail(d.email)
        setRole(d.role)
      })
      .catch((e: Error) => setError(e.message))
  }, [token])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const res = await fetch('/api/team/accept-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, name, password }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError((d as { error?: string }).error || 'Could not accept invite')
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div className="bg-white border border-line rounded-xl3 px-8 py-8 max-w-md w-full text-center">
        <h1 className="text-lg font-extrabold mb-2">You&apos;re in</h1>
        <p className="text-sm text-ink-3 mb-4">Your account is ready. Sign in to continue.</p>
        <a href="/login" className="inline-block bg-pink text-white rounded-xl2 px-4 py-2 text-sm font-bold">
          Go to sign in
        </a>
      </div>
    )
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="bg-white border border-line rounded-xl3 px-8 py-8 max-w-md w-full space-y-3"
    >
      <h1 className="text-lg font-extrabold">Accept invite</h1>
      <p className="text-sm text-ink-3">
        {email ? (
          <>
            Joining as <b>{email}</b> ({role})
          </>
        ) : (
          'Loading invite…'
        )}
      </p>
      <input
        required
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full border border-line rounded-xl2 px-3 py-2.5 text-sm"
      />
      <input
        required
        type="password"
        placeholder="Choose a password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full border border-line rounded-xl2 px-3 py-2.5 text-sm"
      />
      {error && <p className="text-xs text-pink font-semibold">{error}</p>}
      <button type="submit" className="w-full bg-pink text-white rounded-xl2 py-2.5 text-sm font-bold">
        Create account
      </button>
    </form>
  )
}

export default function AcceptInvitePage() {
  return (
    <main className="min-h-screen bg-surface-2 flex items-center justify-center p-6">
      <Suspense fallback={<p className="text-ink-3 text-sm">Loading…</p>}>
        <AcceptInviteForm />
      </Suspense>
    </main>
  )
}
