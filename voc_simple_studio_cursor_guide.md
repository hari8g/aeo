# Customer Insights Studio — Cursor Implementation Guide
## The business-user-facing Studio Runtime for the VoC Intelligence Agent

> **How to use this file**: Hand each numbered prompt to Cursor in order, inside the
> `avp` monorepo created earlier (or a fresh repo if starting standalone). Each prompt
> is self-contained — what to build, exact code, and an acceptance gate to verify
> before moving to the next. Do not skip prompts; later ones depend on earlier ones.
>
> **What this is**: A clean, non-technical web app for product managers and customer
> success teams — feedback ingestion, a pain point board, settings, and a full
> team/identity/access management layer. No graph jargon, no episodic memory
> inspector, no technical activity logs. Those exist in the engineering-facing
> Studio Runtime (a separate app) — this one is for business stakeholders only.
>
> **What it connects to**: The existing Agentic Value Platform API (`packages/platform`,
> port 7070) for pain point and signal data. This guide adds new API routes to that
> same server for ingestion, team management, and auth — it does not stand up a
> second backend.

---

## Prerequisites

```bash
# Node 20 LTS, pnpm 9 — same as the rest of the AVP monorepo
node -v    # v20.x
pnpm -v    # 9.x

# The Platform API must already be running (from earlier AVP setup)
curl http://localhost:7070/health
# → {"status":"ok", ...}
```

---

## Ground rules for Cursor

1. **This is a new package inside the existing `avp` monorepo**: `packages/studio-web/`.
   It is a Next.js 14 App Router application, not a modification of any existing agent code.
2. **Never expose graph terminology in any UI string.** No "node," "edge," "cluster,"
   "episodic memory," "importance_score." Use plain business language throughout —
   "customers affected," "problem," "start working on this."
3. **Tailwind only, no inline styles**, using the design tokens defined in Prompt 1.
   Match the pink/rose accent (`#DB2777`) established for the Listen domain.
4. **Every write action (invite, settings change, SSO toggle) must call a real API
   route** — no client-only state that silently doesn't persist. If a backend route
   doesn't exist yet, build it as part of the same prompt.
5. **Role-gate every page server-side**, not just by hiding UI elements client-side.
   A Viewer hitting `/settings` directly must be redirected, not just missing a button.

---

## PROMPT 1 — Project scaffold and design tokens

**What to build:**

```bash
cd avp/packages
pnpm create next-app@latest studio-web --typescript --tailwind --app --no-src-dir --import-alias "@/*"
cd studio-web
pnpm add next-auth@beta @next-auth/prisma-adapter
pnpm add zod react-hook-form @hookform/resolvers
pnpm add lucide-react
pnpm add -D prisma
```

**Create** `packages/studio-web/tailwind.config.ts` — extend the theme with the exact
design tokens from the approved mockup:

```typescript
import type { Config } from 'tailwindcss'

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        pink:   { DEFAULT: '#DB2777', bg: '#FDF2F8', bd: '#FBCFE8' },
        ok:     { DEFAULT: '#0D9268', bg: '#F0FDF9', bd: '#A7DFCA' },
        amber:  { DEFAULT: '#D97706', bg: '#FFFBEB', bd: '#FCD34D' },
        blue:   { DEFAULT: '#2563EB', bg: '#EFF6FF', bd: '#BFDBFE' },
        ink:    { 1: '#0F172A', 2: '#586174', 3: '#98A2B3' },
        surface:{ 1: '#FAFBFC', 2: '#F3F5F9' },
        line:   { DEFAULT: '#E9ECF2', 2: '#DDE2EA' },
      },
      borderRadius: { xl2: '14px', xl3: '16px' },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config
```

**Create** `packages/studio-web/app/layout.tsx` with the Inter font loaded via
`next/font/google` (not a CDN `<link>` — Next.js handles font optimization natively).

**Acceptance gate:** `pnpm dev` runs on `localhost:3000`, shows the default Next.js
page styled with Tailwind, Inter font renders correctly.

---

## PROMPT 2 — Database schema for team, roles, and auth

**Problem it solves:** Team & Access needs real persistence — invited members, their
roles, SSO configuration. This extends the existing AVP PostgreSQL database (from
`packages/platform`), not a new database.

**Modify** `packages/platform/src/db/schema.sql` — append:

```sql
-- Studio users (separate from agent identities — these are humans, not agents)
CREATE TABLE IF NOT EXISTS studio_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  avatar_url    TEXT,
  role          TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','editor','viewer')),
  workspace_id  TEXT NOT NULL DEFAULT 'default',
  sso_provider  TEXT,                    -- 'google' | 'microsoft' | 'okta' | null (password auth)
  password_hash TEXT,                    -- null if SSO-only
  invited_by    UUID REFERENCES studio_users(id),
  last_active_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON studio_users(workspace_id);

-- Pending invitations
CREATE TABLE IF NOT EXISTS studio_invitations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
  workspace_id TEXT NOT NULL DEFAULT 'default',
  invited_by   UUID REFERENCES studio_users(id),
  token        TEXT UNIQUE NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  accepted_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workspace-level settings (notifications, retention, language)
CREATE TABLE IF NOT EXISTS studio_settings (
  workspace_id            TEXT PRIMARY KEY DEFAULT 'default',
  notify_big_problems     BOOLEAN NOT NULL DEFAULT true,
  weekly_summary_email    BOOLEAN NOT NULL DEFAULT true,
  auto_group_feedback     BOOLEAN NOT NULL DEFAULT true,
  summary_language        TEXT NOT NULL DEFAULT 'en',
  retention_months        INTEGER NOT NULL DEFAULT 12,
  require_sso             BOOLEAN NOT NULL DEFAULT false,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO studio_settings (workspace_id) VALUES ('default') ON CONFLICT DO NOTHING;

-- SSO provider connections (per workspace)
CREATE TABLE IF NOT EXISTS studio_sso_connections (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  provider     TEXT NOT NULL CHECK (provider IN ('google','microsoft','okta')),
  client_id    TEXT,
  client_secret_encrypted TEXT,
  connected_at TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, provider)
);

-- Feedback connector connections (Zendesk, Intercom, Slack)
CREATE TABLE IF NOT EXISTS studio_connectors (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  connector    TEXT NOT NULL CHECK (connector IN ('zendesk','intercom','slack')),
  config_json  JSONB DEFAULT '{}',
  connected_at TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, connector)
);
```

**Run migration:**
```bash
pnpm -F @avp/platform db:migrate
```

**Acceptance gate:** `SELECT * FROM studio_settings;` returns one default row.
All five new tables exist via `\dt studio_*` in psql.

---

## PROMPT 3 — Auth with NextAuth (credentials + SSO)

**What to build:** `packages/studio-web/app/api/auth/[...nextauth]/route.ts`

```typescript
import NextAuth from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id'
import CredentialsProvider from 'next-auth/providers/credentials'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    MicrosoftEntraID({
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      issuer: process.env.MICROSOFT_TENANT_ISSUER,
    }),
    CredentialsProvider({
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const { rows } = await pool.query(
          `SELECT id, email, name, role, password_hash FROM studio_users WHERE email = $1`,
          [credentials?.email],
        )
        const user = rows[0]
        if (!user || !user.password_hash) return null
        const valid = await bcrypt.compare(credentials!.password as string, user.password_hash)
        if (!valid) return null
        return { id: user.id, email: user.email, name: user.name, role: user.role }
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      // On SSO sign-in, auto-create the studio_users row if it doesn't exist,
      // defaulting to 'viewer' — an admin must explicitly upgrade the role.
      if (account?.provider !== 'credentials') {
        const { rows } = await pool.query(`SELECT id FROM studio_users WHERE email = $1`, [user.email])
        if (rows.length === 0) {
          await pool.query(
            `INSERT INTO studio_users (email, name, role, sso_provider) VALUES ($1,$2,'viewer',$3)`,
            [user.email, user.name, account?.provider],
          )
        }
      }
      // Check require_sso setting — block password login if SSO is mandatory
      if (account?.provider === 'credentials') {
        const { rows } = await pool.query(`SELECT require_sso FROM studio_settings WHERE workspace_id='default'`)
        if (rows[0]?.require_sso) return false
      }
      return true
    },
    async session({ session, token }) {
      if (session.user) {
        const { rows } = await pool.query(`SELECT id, role FROM studio_users WHERE email=$1`, [session.user.email])
        ;(session.user as any).role = rows[0]?.role ?? 'viewer'
        ;(session.user as any).id = rows[0]?.id
      }
      return session
    },
  },
  pages: { signIn: '/login' },
})
```

**Create** `packages/studio-web/middleware.ts` for server-side role gating:

```typescript
import { auth } from '@/app/api/auth/[...nextauth]/route'
import { NextResponse } from 'next/server'

const ADMIN_ONLY = ['/settings', '/access']

export default auth((req) => {
  const path = req.nextUrl.pathname
  if (!req.auth) return NextResponse.redirect(new URL('/login', req.url))

  const role = (req.auth.user as any)?.role
  if (ADMIN_ONLY.some(p => path.startsWith(p)) && role !== 'admin') {
    return NextResponse.redirect(new URL('/', req.url))
  }
})

export const config = { matcher: ['/((?!login|api/auth|_next/static|_next/image).*)'] }
```

**Create** `packages/studio-web/app/login/page.tsx` — simple centered card with:
email/password fields, "Sign in with Google" and "Sign in with Microsoft" buttons.
Fetch `require_sso` from a public settings endpoint and hide the password fields
entirely if SSO is mandatory.

**Environment variables** — add to `.env.local`:
```
DATABASE_URL=postgresql://avp:avp_dev_password@localhost:5432/avp
NEXTAUTH_SECRET=<generate with: openssl rand -base64 32>
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ISSUER=
```

**Acceptance gate:** Visiting any page while logged out redirects to `/login`.
Signing in with a seeded test user (see Prompt 8 for seeding) lands on Home.
Visiting `/settings` as a Viewer-role user redirects back to Home.

---

## PROMPT 4 — App shell (sidebar, top bar, layout)

**Create** `packages/studio-web/app/(app)/layout.tsx` — the authenticated shell
wrapping every page below it:

```tsx
import { auth } from '@/app/api/auth/[...nextauth]/route'
import Sidebar from '@/components/Sidebar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  return (
    <div className="grid grid-cols-[230px_1fr] min-h-screen bg-surface-2">
      <Sidebar user={session!.user} />
      <main className="px-10 py-8 pb-20 max-w-[1120px]">{children}</main>
    </div>
  )
}
```

**Create** `packages/studio-web/components/Sidebar.tsx`:

```tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Inbox, Lightbulb, Settings, Users } from 'lucide-react'

const NAV = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/feedback', label: 'Add Feedback', icon: Inbox },
  { href: '/pain-points', label: 'Pain Points', icon: Lightbulb },
  { href: '/settings', label: 'Settings', icon: Settings, adminOnly: true },
  { href: '/access', label: 'Team & Access', icon: Users, adminOnly: true },
]

export default function Sidebar({ user }: { user: any }) {
  const pathname = usePathname()
  const isAdmin = user.role === 'admin'

  return (
    <aside className="bg-white border-r border-line px-4 py-6 sticky top-0 h-screen flex flex-col">
      <div className="flex items-center gap-2 px-2 pb-6">
        <div className="w-8 h-8 rounded-lg bg-pink flex items-center justify-center text-white">👂</div>
        <b className="text-[15px] font-extrabold tracking-tight">Customer Insights</b>
      </div>

      <nav className="flex-1">
        {NAV.filter(item => !item.adminOnly || isAdmin).map(item => {
          const active = pathname === item.href
          return (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold mb-0.5
                ${active ? 'bg-pink-bg text-pink' : 'text-ink-2 hover:bg-surface-1'}`}>
              <item.icon size={18} />{item.label}
            </Link>
          )
        })}
      </nav>

      <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-surface-1">
        <div className="w-8 h-8 rounded-full bg-pink text-white text-xs font-bold flex items-center justify-center">
          {user.name?.split(' ').map((n: string) => n[0]).join('')}
        </div>
        <div>
          <div className="text-xs font-bold">{user.name}</div>
          <div className="text-[10px] text-ink-3 capitalize">{user.role}</div>
        </div>
      </div>
    </aside>
  )
}
```

**Acceptance gate:** Sidebar renders with the logged-in user's initials and role.
Settings and Team & Access links are hidden entirely for non-admin users (not just
disabled — absent from the DOM).

---

## PROMPT 5 — Home dashboard

**Create** `packages/studio-web/app/(app)/page.tsx`

Fetch three summary stats from the Platform API's `/graph/query` endpoint (read-only,
no auth needed per the existing platform design):
- Count of `PAIN_POINT` nodes created in the last 7 days
- Total count of `CUSTOMER_SIGNAL` nodes ever
- The `metadata->>'signalCount'` of the highest-`importance_score` open pain point

```tsx
async function getStats() {
  const res = await fetch('http://localhost:7070/graph/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: `
        SELECT
          (SELECT COUNT(*) FROM graph_nodes WHERE kind='PAIN_POINT' AND created_at > NOW() - INTERVAL '7 days') as new_problems,
          (SELECT COUNT(*) FROM graph_nodes WHERE kind='CUSTOMER_SIGNAL') as total_feedback,
          (SELECT (metadata->>'signalCount')::int FROM graph_nodes WHERE kind='PAIN_POINT' ORDER BY (metadata->>'importanceScore')::float DESC LIMIT 1) as top_affected
      `,
    }),
    cache: 'no-store',
  })
  const [row] = await res.json()
  return row
}

export default async function HomePage() {
  const stats = await getStats()
  return (
    <>
      <div className="mb-6">
        <h1 className="text-[22px] font-extrabold tracking-tight mb-1">Good morning 👋</h1>
        <p className="text-ink-3 text-[13.5px]">Here's what customers have been telling you this week.</p>
      </div>
      <div className="grid grid-cols-3 gap-3.5 mb-8">
        <StatCard num={stats.new_problems} label="New problems found this week" accent />
        <StatCard num={stats.total_feedback} label="Pieces of feedback added" />
        <StatCard num={stats.top_affected} label="Customers affected by the top issue" />
      </div>
    </>
  )
}
```

Build `StatCard` as a small shared component (rounded card, big number, muted label —
matches the approved mockup exactly).

**Acceptance gate:** Home page shows three real numbers pulled from the live Platform
API, not hardcoded placeholders.

---

## PROMPT 6 — Add Feedback screen

**Create** `packages/studio-web/app/(app)/feedback/page.tsx`

Four format options as clickable cards (Upload a file / Paste text / Connect a tool /
Forward an email), matching the approved mockup. Only "Upload a file" and "Paste text"
need working upload logic in this prompt — connector OAuth flows are Prompt 7.

**Add a new Platform API route** for file ingestion — `packages/platform/src/server.ts`:

```typescript
import multipart from '@fastify/multipart'
import { parse } from 'csv-parse/sync'

await app.register(multipart)

app.post('/ingest/file', async (req, reply) => {
  const data = await (req as any).file()
  const buffer = await data.toBuffer()
  const rows = parse(buffer, { columns: true, skip_empty_lines: true }) as
    { date: string; cohort: string; type: string; text: string }[]

  // Call the VoC Intelligence Agent's HTTP adapter to write signals
  // (reuses the same createHttpAdapter + VoCIntelligenceAgent from earlier)
  const adapter = await createHttpAdapter(PLATFORM_URL, VOC_MANIFEST)
  const agent = new VoCIntelligenceAgent(adapter, llm)
  const result = await agent.run({ signals: rows })

  return { ingested: rows.length, painPointsFound: result.clusterCount }
})

app.post('/ingest/text', async (req: any) => {
  const { text } = req.body as { text: string }
  const rows = text.split('\n').filter(Boolean).map((line: string) => ({
    date: new Date().toISOString().slice(0, 10), cohort: 'manual', type: 'feature_request', text: line,
  }))
  const adapter = await createHttpAdapter(PLATFORM_URL, VOC_MANIFEST)
  const agent = new VoCIntelligenceAgent(adapter, llm)
  const result = await agent.run({ signals: rows })
  return { ingested: rows.length, painPointsFound: result.clusterCount }
})
```

**Client-side upload component** with drag-and-drop (use `react-dropzone` or native
HTML5 drag events), progress state, and a success toast: "34 pieces of feedback
added — 2 new problems found."

**Acceptance gate:** Dragging a CSV with 5+ rows of feedback onto the dropzone
results in new `PAIN_POINT` nodes appearing on the Pain Points board within seconds.

---

## PROMPT 7 — Connector cards (Zendesk, Intercom, Slack)

**What to build:** The three connector rows shown in the mockup, each with a
Connect/Connected state persisted to the new `studio_connectors` table.

**Add Platform API routes:**

```typescript
app.get('/connectors', async () => {
  return query(`SELECT connector, connected_at FROM studio_connectors WHERE workspace_id='default'`)
})

app.post<{ Body: { connector: string } }>('/connectors/:connector/connect', async (req) => {
  // For this implementation phase, this stubs the OAuth handshake —
  // wire real Zendesk/Intercom OAuth apps in a follow-up phase.
  await query(`
    INSERT INTO studio_connectors (connector, connected_at) VALUES ($1, NOW())
    ON CONFLICT (workspace_id, connector) DO UPDATE SET connected_at = NOW()
  `, [req.params.connector])
  return { connected: true }
})
```

**Client component**: each connector row fetches its connection status on load and
shows either a "✓ Connected" pill or a "Connect" button that calls the connect route.

**Acceptance gate:** Clicking "Connect" on Intercom flips its pill to "✓ Connected"
and the state persists across a page refresh (reads from `studio_connectors`).

---

## PROMPT 8 — Pain Points board

**Create** `packages/studio-web/app/(app)/pain-points/page.tsx`

Fetch pain points from the graph, with plain-language sizing (customer count, not
importance score) and trend detection:

```typescript
async function getPainPoints(cohortFilter?: string) {
  const res = await fetch('http://localhost:7070/graph/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: `
        SELECT id, label, metadata,
          (SELECT COUNT(*) FROM graph_edges ge JOIN graph_nodes gn ON gn.id = ge.from_node_id
           WHERE ge.to_node_id = graph_nodes.id AND ge.kind='EXPRESSES'
           AND gn.created_at > NOW() - INTERVAL '7 days') as recent_signal_count
        FROM graph_nodes WHERE kind='PAIN_POINT'
        ORDER BY (metadata->>'importanceScore')::float DESC
      `,
    }), cache: 'no-store',
  })
  return res.json()
}
```

Render each as a `pp-row` matching the mockup exactly: colored accent bar (pink for
top-priority, blue for medium, grey for quiet/stale), title, tag chips (cohort +
trend), a big customer count, and a CTA button. The CTA — "Start working on this" —
calls the existing cycle-start flow (`POST /cycles` then triggers the Business Case
Agent), which is the actual handoff into the Decide phase.

**Trend logic**: if `recent_signal_count` (last 7 days) is more than 20% of the total
signal count, show "↑ Growing fast." If no new signals in 21+ days, show "Quiet
lately" with a grey accent instead of pink.

**Acceptance gate:** Board shows real pain points sorted by size. Clicking
"Start working on this" on the top card creates a new cycle and the button changes
to a disabled "In progress" state.

---

## PROMPT 9 — Settings screen

**Create** `packages/studio-web/app/(app)/settings/page.tsx` (admin-only, enforced
by the middleware from Prompt 3).

Five rows exactly as the mockup: two toggles bound to `studio_settings` fields
(`notify_big_problems`, `weekly_summary_email`, `auto_group_feedback`), and two
selects (`summary_language`, `retention_months`).

**Add Platform API routes:**

```typescript
app.get('/settings', async () => queryOne(`SELECT * FROM studio_settings WHERE workspace_id='default'`))

app.patch<{ Body: Partial<{
  notifyBigProblems: boolean; weeklySummaryEmail: boolean; autoGroupFeedback: boolean
  summaryLanguage: string; retentionMonths: number
}> }>('/settings', async (req) => {
  const fields = req.body
  const setClauses = Object.entries(fields).map(([k, v], i) =>
    `${k.replace(/[A-Z]/g, m => '_' + m.toLowerCase())} = $${i + 1}`)
  await query(`UPDATE studio_settings SET ${setClauses.join(', ')}, updated_at=NOW() WHERE workspace_id='default'`,
    Object.values(fields))
  return { updated: true }
})
```

Each toggle click should optimistically flip the UI, call the PATCH route, and
revert on failure with a small error toast.

**Acceptance gate:** Toggling "Weekly summary email" off, then refreshing the page,
shows it still off — confirming it persisted rather than being client-only state.

---

## PROMPT 10 — Team & Access screen

**Create** `packages/studio-web/app/(app)/access/page.tsx` (admin-only).

### 10a — Invite flow
Email input + role dropdown + "Send invite" button. On submit:

```typescript
app.post<{ Body: { email: string; role: string } }>('/team/invite', async (req) => {
  const token = crypto.randomUUID()
  await query(`
    INSERT INTO studio_invitations (email, role, token, expires_at)
    VALUES ($1, $2, $3, NOW() + INTERVAL '7 days')
  `, [req.body.email, req.body.role, token])
  // Send an email via your provider of choice (Resend, SES, etc.) with a link:
  // https://studio.yourcompany.com/accept-invite?token=${token}
  return { invited: true }
})
```

Build a matching `/accept-invite` public page that validates the token, lets the
invitee set a password (or skip straight to SSO), and creates their `studio_users` row.

### 10b — Member table
List all `studio_users` for the workspace with avatar initials, role badge (colored
per the mockup: pink for Admin, blue for Editor, grey for Viewer), and last active
timestamp. A "Manage" button opens a small dropdown to change role or remove the member
— both admin-only actions, both requiring a confirmation step before removal.

### 10c — Role explainer cards
Three static cards explaining Admin / Editor / Viewer in plain language exactly as
the mockup shows — this is documentation, not a data-driven component.

### 10d — SSO connection management
For each of Google Workspace, Microsoft 365, Okta: show connected/not-connected
state from `studio_sso_connections`, with a "Connect" flow that walks the admin
through creating an OAuth app (link out to setup docs) and pasting in a Client ID
and Secret, which get stored (secret encrypted at rest — use `pgcrypto` or an
application-level encryption key, never store plaintext).

### 10e — Require SSO toggle
A final toggle, "Require single sign-on for everyone," bound to
`studio_settings.require_sso`. Disable this toggle in the UI (with an explanatory
tooltip) if fewer than one SSO provider is connected — you cannot mandate SSO with
nothing to sign in with.

**Acceptance gate:** Inviting a test email address creates a row in
`studio_invitations`. Changing a member's role from Viewer to Editor in the UI
updates `studio_users.role` and that user's next login reflects new page access.
Toggling "Require SSO" is disabled until at least one provider shows Connected.

---

## PROMPT 11 — Seed data for local development

**Create** `packages/platform/src/db/seed.ts`:

```typescript
import bcrypt from 'bcryptjs'
import { query } from './pool.js'

async function seed() {
  const passwordHash = await bcrypt.hash('demo1234', 10)
  await query(`
    INSERT INTO studio_users (email, name, role, password_hash) VALUES
      ('sarah@yourcompany.com', 'Sarah Kim', 'admin', $1),
      ('raj@yourcompany.com', 'Raj Joshi', 'editor', $1),
      ('anita@yourcompany.com', 'Anita Menon', 'viewer', $1)
    ON CONFLICT (email) DO NOTHING
  `, [passwordHash])
  console.log('Seeded 3 studio users — password for all: demo1234')
}
seed()
```

```bash
pnpm -F @avp/platform exec tsx src/db/seed.ts
```

**Acceptance gate:** Logging in as `sarah@yourcompany.com` / `demo1234` shows all
five nav items including Settings and Team & Access. Logging in as
`anita@yourcompany.com` shows only Home, Add Feedback, and Pain Points.

---

## PROMPT 12 — End-to-end validation

Run this script by hand once all prompts are complete:

1. **Log in** as the seeded admin (`sarah@yourcompany.com`).
2. **Add Feedback** → upload a 5-row CSV with obviously related complaints about one
   topic. Confirm the success toast reports at least 1 problem found.
3. **Pain Points** → confirm the new problem appears at the top (highest customer
   count / most recent), with the correct cohort tags.
4. Click **Start working on this** → confirm a cycle begins (the button becomes
   "In progress").
5. **Settings** → toggle off "Weekly summary email," refresh the page, confirm it's
   still off.
6. **Team & Access** → invite a new teammate as Editor, confirm the invitation row
   exists in the database.
7. **Log out**, log in as the seeded Viewer (`anita@yourcompany.com`) → confirm
   Settings and Team & Access are not present in the sidebar, and navigating to
   `/settings` directly redirects to Home.
8. **Connect Google Workspace SSO** (or stub it in dev) → confirm the "Require SSO"
   toggle becomes enabled once at least one provider shows Connected.

**If any step fails**, the fix is almost always in one of three places: the
Platform API route wasn't added correctly (check `packages/platform/src/server.ts`),
the middleware role check isn't matching the session shape (check Prompt 3's
`session` callback), or a Tailwind class typo is silently not applying (check
against the token names in Prompt 1's config).

---

## File map — what each prompt creates

| Prompt | Files |
|---|---|
| 1 | `studio-web/` scaffold, `tailwind.config.ts`, `app/layout.tsx` |
| 2 | `platform/src/db/schema.sql` (5 new tables) |
| 3 | `app/api/auth/[...nextauth]/route.ts`, `middleware.ts`, `app/login/page.tsx` |
| 4 | `app/(app)/layout.tsx`, `components/Sidebar.tsx` |
| 5 | `app/(app)/page.tsx`, `components/StatCard.tsx` |
| 6 | `app/(app)/feedback/page.tsx`, `platform/server.ts` (+2 routes) |
| 7 | `platform/server.ts` (+2 routes), connector card component |
| 8 | `app/(app)/pain-points/page.tsx` |
| 9 | `app/(app)/settings/page.tsx`, `platform/server.ts` (+2 routes) |
| 10 | `app/(app)/access/page.tsx`, `app/accept-invite/page.tsx`, `platform/server.ts` (+4 routes) |
| 11 | `platform/src/db/seed.ts` |
| 12 | Validation only |

**New Platform API routes added across this guide:** 8
**New database tables:** 5
**New Next.js pages:** 7

---

*End of implementation guide. This app is intentionally the "front door" for
non-technical stakeholders — the engineering-facing Studio Runtime with episodic
memory inspection, activity logs, and dedup tooling remains a separate app for
platform teams and stays out of this one entirely.*
