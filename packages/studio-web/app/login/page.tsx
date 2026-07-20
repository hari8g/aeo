'use client'

import { signIn } from 'next-auth/react'
import { useEffect, useState } from 'react'
import BoschLogo from '@/components/BoschLogo'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [requireSso, setRequireSso] = useState(false)
  const [demoEnabled, setDemoEnabled] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [demoLoading, setDemoLoading] = useState(false)

  useEffect(() => {
    fetch('/api/public-settings')
      .then((r) => r.json())
      .then((d: { requireSso?: boolean; demoBypass?: boolean }) => {
        setRequireSso(!!d.requireSso)
        if (typeof d.demoBypass === 'boolean') setDemoEnabled(d.demoBypass)
      })
      .catch(() => undefined)
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })
    setLoading(false)
    if (res?.error) {
      setError('Could not sign in. Check your email and password.')
      return
    }
    window.location.href = '/'
  }

  async function enterDemo() {
    setDemoLoading(true)
    setError('')
    try {
      const prep = await fetch('/api/demo/prepare', { method: 'POST' })
      if (!prep.ok) {
        const body = (await prep.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || 'Could not prepare demo data')
      }
      const res = await signIn('demo', { redirect: false })
      if (res?.error) throw new Error('Demo sign-in failed')
      window.location.href = '/?demo=1'
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Demo sign-in failed')
      setDemoLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-surface-2 flex flex-col">
      <header className="bg-white border-b border-line px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <BoschLogo variant="full" />
          <div className="hidden sm:block h-8 w-px bg-line" />
          <div className="hidden sm:block">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-bosch-muted">
              Mobility Platform &amp; Solutions
            </div>
            <div className="text-sm font-extrabold text-ink-1">Customer Insights</div>
          </div>
        </div>
        <a
          href="https://www.bosch-mps.com/en/home"
          target="_blank"
          rel="noreferrer"
          className="text-xs font-semibold text-bosch-muted hover:text-bosch-red"
        >
          bosch-mps.com
        </a>
      </header>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg">
          <div className="mb-6">
            <h1 className="text-[26px] font-extrabold tracking-tight text-ink-1 leading-tight mb-2">
              We empower the future of mobility and logistics.
            </h1>
            <p className="text-[13.5px] text-ink-2">
              Connected. Digital. Sustainable. — listen to customers across MLFF tolling, StaaS, and
              logistics platforms.
            </p>
          </div>

          <div className="bg-white border border-line rounded-xl3 px-8 py-8 shadow-none">
            {demoEnabled && (
              <div className="mb-5 rounded-xl2 border border-pink-bd bg-pink-bg px-4 py-4">
                <div className="text-sm font-extrabold text-ink-1 mb-1">Local demo</div>
                <p className="text-[12.5px] text-ink-2 mb-3 leading-relaxed">
                  Skip sign-in and open as <b>Hariprasad</b> (Admin) with MPS sample pain points
                  ready to click through.
                </p>
                <button
                  type="button"
                  disabled={demoLoading}
                  onClick={() => void enterDemo()}
                  className="w-full bg-bosch-red text-white rounded-xl2 py-2.5 text-sm font-bold hover:opacity-90 disabled:opacity-60"
                >
                  {demoLoading ? 'Preparing demo…' : 'Enter demo (no login)'}
                </button>
              </div>
            )}

            {!requireSso && (
              <form onSubmit={onSubmit} className="space-y-3 mb-5">
                <div className="text-[11px] font-bold uppercase tracking-wide text-ink-3">
                  Or sign in with email
                </div>
                <label className="block">
                  <span className="text-xs font-semibold text-ink-2">Email</span>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full border border-line rounded-xl2 px-3 py-2.5 text-sm outline-none focus:border-bosch-red"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-ink-2">Password</span>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 w-full border border-line rounded-xl2 px-3 py-2.5 text-sm outline-none focus:border-bosch-red"
                  />
                </label>
                {error && <p className="text-xs text-bosch-red font-semibold">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full border border-line bg-white text-ink-1 rounded-xl2 py-2.5 text-sm font-bold hover:bg-surface-2 disabled:opacity-60"
                >
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            )}

            {requireSso && !demoEnabled && (
              <p className="text-sm text-ink-2 mb-5">
                Your workspace requires single sign-on. Use one of the options below.
              </p>
            )}

            {error && requireSso && (
              <p className="text-xs text-bosch-red font-semibold mb-3">{error}</p>
            )}

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => signIn('google', { callbackUrl: '/' })}
                className="w-full border border-line rounded-xl2 py-2.5 text-sm font-semibold text-ink-1 hover:bg-surface-2"
              >
                Sign in with Google
              </button>
              <button
                type="button"
                onClick={() => signIn('microsoft-entra-id', { callbackUrl: '/' })}
                className="w-full border border-line rounded-xl2 py-2.5 text-sm font-semibold text-ink-1 hover:bg-surface-2"
              >
                Sign in with Microsoft
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
