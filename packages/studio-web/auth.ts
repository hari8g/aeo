import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id'
import Credentials from 'next-auth/providers/credentials'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import type { Provider } from 'next-auth/providers'
import { isDemoBypassEnabled } from '@/lib/demo'

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://avp:avp_dev_password@localhost:5433/avp',
})

export { isDemoBypassEnabled }

const DEMO_ADMIN = {
  email: 'hariprasad@bosch-mps.com',
  name: 'Hariprasad',
  role: 'admin' as const,
}

async function ensureDemoAdmin() {
  const passwordHash = await bcrypt.hash('demo1234', 10)
  await pool.query(`DELETE FROM studio_users WHERE email = 'sarah@yourcompany.com'`).catch(() => null)
  await pool.query(
    `
    INSERT INTO studio_users (email, name, role, password_hash, last_active_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      role = EXCLUDED.role,
      password_hash = COALESCE(studio_users.password_hash, EXCLUDED.password_hash),
      last_active_at = NOW()
  `,
    [DEMO_ADMIN.email, DEMO_ADMIN.name, DEMO_ADMIN.role, passwordHash],
  )
  const { rows } = await pool.query(
    `SELECT id, email, name, role FROM studio_users WHERE email = $1`,
    [DEMO_ADMIN.email],
  )
  return rows[0] as { id: string; email: string; name: string; role: string }
}

const providers: Provider[] = []

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  )
}

if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
  providers.push(
    MicrosoftEntraID({
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      issuer: process.env.MICROSOFT_TENANT_ISSUER,
    }),
  )
}

providers.push(
  Credentials({
    id: 'demo',
    name: 'Demo bypass',
    credentials: {},
    async authorize() {
      if (!isDemoBypassEnabled()) return null
      const user = await ensureDemoAdmin()
      return { id: user.id, email: user.email, name: user.name, role: user.role }
    },
  }),
)

providers.push(
  Credentials({
    id: 'credentials',
    name: 'Email and password',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
    },
    async authorize(credentials) {
      const email = credentials?.email as string | undefined
      const password = credentials?.password as string | undefined
      if (!email || !password) return null
      const { rows } = await pool.query(
        `SELECT id, email, name, role, password_hash FROM studio_users WHERE email = $1`,
        [email.toLowerCase()],
      )
      const user = rows[0]
      if (!user?.password_hash) return null
      const valid = await bcrypt.compare(password, user.password_hash)
      if (!valid) return null
      await pool.query(`UPDATE studio_users SET last_active_at=NOW() WHERE id=$1`, [user.id])
      return { id: user.id, email: user.email, name: user.name, role: user.role }
    },
  }),
)

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  trustHost: true,
  callbacks: {
    async signIn({ user, account }) {
      // Demo bypass always allowed in local demo mode
      if (account?.provider === 'demo') return isDemoBypassEnabled()

      if (account?.provider !== 'credentials' && account?.provider !== 'demo') {
        const { rows } = await pool.query(`SELECT id FROM studio_users WHERE email = $1`, [
          user.email,
        ])
        if (rows.length === 0 && user.email) {
          await pool.query(
            `INSERT INTO studio_users (email, name, role, sso_provider) VALUES ($1,$2,'viewer',$3)`,
            [user.email.toLowerCase(), user.name ?? user.email, account?.provider ?? null],
          )
        }
      }
      if (account?.provider === 'credentials') {
        const { rows } = await pool.query(
          `SELECT require_sso FROM studio_settings WHERE workspace_id='default'`,
        )
        if (rows[0]?.require_sso) return false
      }
      return true
    },
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role
        token.sub = user.id
        token.name = user.name
      }
      // Migrate legacy demo admin sessions (Sarah Kim → Hariprasad)
      if (token.email === 'sarah@yourcompany.com') {
        token.email = DEMO_ADMIN.email
      }
      if (token.email) {
        const { rows } = await pool.query(
          `SELECT id, role, name, email FROM studio_users WHERE email=$1`,
          [token.email],
        )
        if (rows[0]) {
          token.role = rows[0].role
          token.sub = rows[0].id
          token.name = rows[0].name
          token.email = rows[0].email
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        ;(session.user as { role?: string }).role = (token.role as string) ?? 'viewer'
        ;(session.user as { id?: string }).id = token.sub as string
        session.user.name = (token.name as string) ?? DEMO_ADMIN.name
        session.user.email = (token.email as string) ?? DEMO_ADMIN.email
      }
      return session
    },
  },
  pages: { signIn: '/login' },
})
