import { isDemoBypassEnabled } from '@/lib/demo'
import { platformFetch } from '@/lib/platform'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const runtime = 'nodejs'

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://avp:avp_dev_password@localhost:5433/avp',
})

type DemoPainPoint = {
  label: string
  description: string
  cohorts?: string[]
  signalCount?: number
  importanceScore?: number
  tags?: string[]
  trend?: string
  quotes?: string[]
}

function loadDemoPainPoints(): DemoPainPoint[] {
  try {
    const path = join(process.cwd(), 'demo', 'mps-pain-points.json')
    return JSON.parse(readFileSync(path, 'utf8')) as DemoPainPoint[]
  } catch {
    return []
  }
}

/**
 * Prepare a demonstrable workspace for local demo login:
 * seed users, Toll.OS MLFF + StaaS 3PL pain points, a connector, SSO stub, open settings.
 */
export async function POST() {
  if (!isDemoBypassEnabled()) {
    return Response.json({ error: 'Demo bypass disabled' }, { status: 403 })
  }

  const passwordHash = await bcrypt.hash('demo1234', 10)
  await pool.query(
    `
    INSERT INTO studio_users (email, name, role, password_hash) VALUES
      ('hariprasad@bosch-mps.com', 'Hariprasad', 'admin', $1),
      ('pradeep.r@bosch-mps.com', 'Pradeep R', 'viewer', $1)
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      role = EXCLUDED.role,
      password_hash = EXCLUDED.password_hash
  `,
    [passwordHash],
  )
  // Keep members list to Hariprasad (admin) + Pradeep R (viewer) only
  await pool.query(
    `
    WITH legacy AS (
      SELECT id FROM studio_users
      WHERE email IN ('sarah@yourcompany.com', 'raj@yourcompany.com', 'anita@yourcompany.com')
    )
    UPDATE studio_users SET invited_by = NULL WHERE invited_by IN (SELECT id FROM legacy);
    WITH legacy AS (
      SELECT id FROM studio_users
      WHERE email IN ('sarah@yourcompany.com', 'raj@yourcompany.com', 'anita@yourcompany.com')
    )
    UPDATE studio_invitations SET invited_by = NULL WHERE invited_by IN (SELECT id FROM legacy);
    DELETE FROM studio_users
    WHERE email IN ('sarah@yourcompany.com', 'raj@yourcompany.com', 'anita@yourcompany.com');
  `,
  ).catch(() => null)

  await pool.query(
    `UPDATE studio_settings SET
       require_sso = false,
       weekly_summary_email = true,
       notify_big_problems = true,
       auto_group_feedback = true,
       updated_at = NOW()
     WHERE workspace_id = 'default'`,
  )

  await platformFetch('/connectors/intercom/connect', { method: 'POST' }).catch(() => null)

  await platformFetch('/sso/google/connect', {
    method: 'POST',
    body: JSON.stringify({
      clientId: 'demo-google-client',
      clientSecret: 'demo-google-secret',
    }),
  }).catch(() => null)

  const painPoints = loadDemoPainPoints()
  const seed = await platformFetch<{ seeded: number; ids: number[] }>(
    '/studio/demo/seed-pain-points',
    {
      method: 'POST',
      body: JSON.stringify({ painPoints }),
    },
  ).catch(() => ({ seeded: 0, ids: [] as number[] }))

  return Response.json({
    ready: true,
    demoUser: 'hariprasad@bosch-mps.com',
    demoName: 'Hariprasad',
    role: 'admin',
    painPointsSeeded: seed.seeded,
    themes: ['Toll.OS MLFF (₹5/event)', 'StaaS 3PL logistics'],
  })
}
