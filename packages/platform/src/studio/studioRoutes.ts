import type { FastifyInstance } from 'fastify'
import { randomUUID, createCipheriv, createHash, randomBytes } from 'node:crypto'
import multipart from '@fastify/multipart'
import { parse } from 'csv-parse/sync'
import bcrypt from 'bcryptjs'
import { createHttpAdapter } from '@avp/shared/adapters/httpAdapter.js'
import { VOC_MANIFEST, VoCIntelligenceAgent } from '@avp/agents-listen-voc-intelligence'
import { BUSINESS_CASE_MANIFEST, BusinessCaseAgent } from '@avp/agents-decide-business-case'
import { BUSINESS_VALUE_MANIFEST, BusinessValueAgent } from '@avp/agents-decide-value-engineering'
import {
  ENGINEERING_ESTIMATION_MANIFEST,
  EngineeringEstimationAgent,
} from '@avp/agents-decide-solutions-estimation'
import { GTM_STRATEGY_MANIFEST, GtmStrategyAgent } from '@avp/agents-decide-product-strategy'
import {
  PORTFOLIO_ADVISOR_MANIFEST,
  PortfolioAdvisorAgent,
} from '@avp/agents-decide-portfolio-management'
import {
  REQUIREMENTS_ANALYST_MANIFEST,
  RequirementsAnalystAgent,
} from '@avp/agents-define-requirements-analyst'
import {
  DOMAIN_STEWARD_MANIFEST,
  DomainStewardAgent,
} from '@avp/agents-define-domain-steward'
import {
  SOLUTIONS_ARCHITECT_MANIFEST,
  SolutionsArchitectAgent,
} from '@avp/agents-define-solutions-architect'
import {
  SOFTWARE_ENGINEERING_MANIFEST,
  SoftwareEngineeringAgent,
} from '@avp/agents-build-software-engineering'
import {
  QUALITY_ENGINEERING_MANIFEST,
  QualityEngineeringAgent,
} from '@avp/agents-build-quality-engineering'
import {
  DOCUMENTATION_MANIFEST,
  DocumentationAgent,
} from '@avp/agents-build-documentation'
import { query, queryOne } from '../db/pool.js'
import type { CycleOrchestrator } from '../orchestrator/cycleOrchestrator.js'
import type { ILLMGateway } from '@avp/shared'
import { registerShipLearnRoutes } from './shipLearnRoutes.js'

function encryptSecret(plain: string): string {
  const key = createHash('sha256')
    .update(process.env.STUDIO_ENCRYPTION_KEY ?? process.env.NEXTAUTH_SECRET ?? 'avp-dev-studio-key')
    .digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export async function registerStudioRoutes(
  app: FastifyInstance,
  opts: { llm: ILLMGateway; platformUrl: string; orchestrator?: CycleOrchestrator },
): Promise<void> {
  await app.register(multipart)

  app.get('/studio/public/settings', async () => {
    const row = await queryOne<{ require_sso: boolean }>(
      `SELECT require_sso FROM studio_settings WHERE workspace_id='default'`,
    )
    return { requireSso: row?.require_sso ?? false }
  })

  app.get('/studio/stats', async () => {
    const rows = await query<{
      new_problems: string
      total_feedback: string
      top_affected: number | null
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM graph_nodes WHERE kind='PAIN_POINT' AND created_at > NOW() - INTERVAL '7 days') as new_problems,
        (SELECT COUNT(*)::text FROM graph_nodes WHERE kind='CUSTOMER_SIGNAL') as total_feedback,
        (SELECT COALESCE((metadata->>'signalCount')::int, 0) FROM graph_nodes WHERE kind='PAIN_POINT'
         ORDER BY COALESCE((metadata->>'importanceScore')::float, 0) DESC LIMIT 1) as top_affected
    `)
    const row = rows[0]!
    return {
      newProblems: Number(row.new_problems),
      totalFeedback: Number(row.total_feedback),
      topAffected: Number(row.top_affected ?? 0),
    }
  })

  app.get('/studio/pain-points', async () => {
    // When curated demo pain points exist, hide leftover stub/test rows from the board
    const demoCount = await queryOne<{ n: string }>(
      `SELECT COUNT(*)::text as n FROM graph_nodes
       WHERE kind='PAIN_POINT' AND (metadata->>'demo')='true'
         AND COALESCE((metadata->>'demoRetired')::boolean, false) = false`,
    )
    const onlyDemo = parseInt(demoCount?.n ?? '0', 10) > 0

    return query(
      `
      SELECT id, label, description, metadata, created_at, updated_at,
        COALESCE((metadata->>'signalCount')::int, 0) as signal_count,
        (SELECT COUNT(*)::int FROM graph_edges ge
           JOIN graph_nodes gn ON gn.id = ge.from_node_id
           WHERE ge.to_node_id = graph_nodes.id AND ge.kind='EXPRESSES'
           AND gn.created_at > NOW() - INTERVAL '7 days') as recent_signal_count
      FROM graph_nodes
      WHERE kind='PAIN_POINT'
        AND COALESCE((metadata->>'demoRetired')::boolean, false) = false
        AND label NOT IN ('Archived general feedback')
        AND ($1::boolean = false OR (metadata->>'demo') = 'true')
      ORDER BY
        COALESCE((metadata->>'importanceScore')::float, 0) DESC,
        created_at DESC
    `,
      [onlyDemo],
    )
  })

  app.post('/ingest/file', async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.status(400).send({ error: 'file required' })
    const buffer = await data.toBuffer()
    const rows = parse(buffer, { columns: true, skip_empty_lines: true, trim: true }) as {
      date?: string
      cohort?: string
      type?: string
      text: string
    }[]
    if (!rows.length) return reply.status(400).send({ error: 'no rows' })

    const signals = rows.map((r) => ({
      date: r.date || new Date().toISOString().slice(0, 10),
      cohort: r.cohort || 'upload',
      type: (r.type as 'feature_request' | 'pain_point' | 'churn_risk' | 'defect') || 'feature_request',
      text: r.text,
    }))

    const adapter = await createHttpAdapter(opts.platformUrl, VOC_MANIFEST)
    const agent = new VoCIntelligenceAgent(adapter, opts.llm)
    const result = await agent.run({ signals })
    return { ingested: signals.length, painPointsFound: result.clusterCount ?? result.painPointIds.length }
  })

  app.post<{ Body: { text: string } }>('/ingest/text', async (req, reply) => {
    const { text } = req.body ?? {}
    if (!text?.trim()) return reply.status(400).send({ error: 'text required' })
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    const signals = lines.map((line) => ({
      date: new Date().toISOString().slice(0, 10),
      cohort: 'manual',
      type: 'feature_request' as const,
      text: line,
    }))
    const adapter = await createHttpAdapter(opts.platformUrl, VOC_MANIFEST)
    const agent = new VoCIntelligenceAgent(adapter, opts.llm)
    const result = await agent.run({ signals })
    return { ingested: signals.length, painPointsFound: result.clusterCount ?? result.painPointIds.length }
  })

  app.get('/connectors', async () => {
    return query(
      `SELECT connector, connected_at FROM studio_connectors WHERE workspace_id='default'`,
    )
  })

  app.post<{ Params: { connector: string } }>('/connectors/:connector/connect', async (req, reply) => {
    const connector = req.params.connector
    if (!['zendesk', 'intercom', 'slack'].includes(connector)) {
      return reply.status(400).send({ error: 'invalid connector' })
    }
    await query(
      `
      INSERT INTO studio_connectors (workspace_id, connector, connected_at)
      VALUES ('default', $1, NOW())
      ON CONFLICT (workspace_id, connector) DO UPDATE SET connected_at = NOW()
    `,
      [connector],
    )
    return { connected: true }
  })

  app.get('/settings', async () => {
    return queryOne(`SELECT * FROM studio_settings WHERE workspace_id='default'`)
  })

  app.patch<{
    Body: Partial<{
      notifyBigProblems: boolean
      weeklySummaryEmail: boolean
      autoGroupFeedback: boolean
      summaryLanguage: string
      retentionMonths: number
      requireSso: boolean
    }>
  }>('/settings', async (req) => {
    const map: Record<string, string> = {
      notifyBigProblems: 'notify_big_problems',
      weeklySummaryEmail: 'weekly_summary_email',
      autoGroupFeedback: 'auto_group_feedback',
      summaryLanguage: 'summary_language',
      retentionMonths: 'retention_months',
      requireSso: 'require_sso',
    }
    const entries = Object.entries(req.body ?? {}).filter(([k]) => map[k])
    if (!entries.length) return { updated: false }
    const setClauses = entries.map(([k], i) => `${map[k]} = $${i + 1}`)
    await query(
      `UPDATE studio_settings SET ${setClauses.join(', ')}, updated_at=NOW() WHERE workspace_id='default'`,
      entries.map(([, v]) => v),
    )
    return { updated: true }
  })

  app.get('/team/members', async () => {
    return query(
      `SELECT id, email, name, role, last_active_at, created_at, sso_provider
       FROM studio_users WHERE workspace_id='default' ORDER BY created_at`,
    )
  })

  app.post<{ Body: { email: string; role: string; invitedBy?: string } }>(
    '/team/invite',
    async (req, reply) => {
      const { email, role, invitedBy } = req.body
      if (!email || !['admin', 'editor', 'viewer'].includes(role)) {
        return reply.status(400).send({ error: 'email and valid role required' })
      }
      const token = randomUUID()
      await query(
        `
        INSERT INTO studio_invitations (email, role, token, expires_at, invited_by)
        VALUES ($1, $2, $3, NOW() + INTERVAL '7 days', $4)
      `,
        [email.toLowerCase(), role, token, invitedBy ?? null],
      )
      console.log(`[Studio] Invite for ${email}: /accept-invite?token=${token}`)
      return { invited: true, token }
    },
  )

  app.get<{ Querystring: { token: string } }>('/team/invite', async (req, reply) => {
    const inv = await queryOne<{
      id: string
      email: string
      role: string
      expires_at: string
      accepted_at: string | null
    }>(
      `SELECT id, email, role, expires_at, accepted_at FROM studio_invitations WHERE token=$1`,
      [req.query.token],
    )
    if (!inv || inv.accepted_at) return reply.status(404).send({ error: 'invalid invite' })
    if (new Date(inv.expires_at) < new Date()) return reply.status(410).send({ error: 'expired' })
    return inv
  })

  app.post<{ Body: { token: string; name: string; password?: string } }>(
    '/team/accept-invite',
    async (req, reply) => {
      const { token, name, password } = req.body
      const inv = await queryOne<{ email: string; role: string; accepted_at: string | null; expires_at: string }>(
        `SELECT email, role, accepted_at, expires_at FROM studio_invitations WHERE token=$1`,
        [token],
      )
      if (!inv || inv.accepted_at) return reply.status(404).send({ error: 'invalid invite' })
      if (new Date(inv.expires_at) < new Date()) return reply.status(410).send({ error: 'expired' })

      const passwordHash = password ? await bcrypt.hash(password, 10) : null
      await query(
        `
        INSERT INTO studio_users (email, name, role, password_hash)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role,
          password_hash=COALESCE(EXCLUDED.password_hash, studio_users.password_hash)
      `,
        [inv.email, name, inv.role, passwordHash],
      )
      await query(`UPDATE studio_invitations SET accepted_at=NOW() WHERE token=$1`, [token])
      return { accepted: true }
    },
  )

  app.patch<{ Params: { id: string }; Body: { role: string } }>(
    '/team/members/:id',
    async (req, reply) => {
      if (!['admin', 'editor', 'viewer'].includes(req.body.role)) {
        return reply.status(400).send({ error: 'invalid role' })
      }
      await query(`UPDATE studio_users SET role=$1 WHERE id=$2`, [req.body.role, req.params.id])
      return { updated: true }
    },
  )

  app.delete<{ Params: { id: string } }>('/team/members/:id', async (req) => {
    await query(`DELETE FROM studio_users WHERE id=$1`, [req.params.id])
    return { removed: true }
  })

  app.get('/sso/connections', async () => {
    return query(
      `SELECT provider, client_id, connected_at,
              (client_secret_encrypted IS NOT NULL) as has_secret
       FROM studio_sso_connections WHERE workspace_id='default'`,
    )
  })

  app.post<{
    Params: { provider: string }
    Body: { clientId: string; clientSecret: string }
  }>('/sso/:provider/connect', async (req, reply) => {
    const provider = req.params.provider
    if (!['google', 'microsoft', 'okta'].includes(provider)) {
      return reply.status(400).send({ error: 'invalid provider' })
    }
    const { clientId, clientSecret } = req.body
    if (!clientId || !clientSecret) return reply.status(400).send({ error: 'clientId and clientSecret required' })
    await query(
      `
      INSERT INTO studio_sso_connections (workspace_id, provider, client_id, client_secret_encrypted, connected_at)
      VALUES ('default', $1, $2, $3, NOW())
      ON CONFLICT (workspace_id, provider) DO UPDATE SET
        client_id=EXCLUDED.client_id,
        client_secret_encrypted=EXCLUDED.client_secret_encrypted,
        connected_at=NOW()
    `,
      [provider, clientId, encryptSecret(clientSecret)],
    )
    return { connected: true }
  })

  /**
   * Seed curated MPS demo pain points (Toll.OS MLFF + StaaS 3PL logistics).
   * Soft-retires prior demo-tagged pain points so the board stays focused.
   */
  app.post<{
    Body?: {
      painPoints?: Array<{
        label: string
        description: string
        cohorts?: string[]
        signalCount?: number
        importanceScore?: number
        tags?: string[]
        trend?: string
        quotes?: string[]
      }>
    }
  }>('/studio/demo/seed-pain-points', async (req) => {
    const defaults = [
      {
        label: 'Toll.OS MLFF events not metered for Bosch MPS ₹5/event revenue',
        description:
          'On Toll.OS Multi-Lane Free Flow corridors, billable orchestration events — ANPR plate diagnosis, RFID FASTag reads, and LiDAR exception handling — are recorded inconsistently, so Bosch MPS cannot reliably bill the contracted ₹5 per event.',
        cohorts: ['toll-operator', 'concessionaire'],
        signalCount: 42,
        importanceScore: 0.96,
        tags: ['Toll.OS', 'MLFF', 'orchestration'],
        trend: 'growing',
        quotes: [
          'We lose thousands of ₹5 events a day when ANPR diagnosis never lands in Toll.OS orchestration.',
          'LiDAR exception-lane events drop before metering — Bosch MPS never invoices those.',
          'RFID FASTag and ANPR must fuse into one billable orchestration event at ₹5.',
        ],
      },
      {
        label: 'StaaS 3PL warehouse inventory lag breaks outbound dock planning',
        description:
          'Third-party logistics (3PL) customers on MPS Store-as-a-Service for logistics see warehouse inventory and ASN updates lag 4–12 hours, so outbound dock schedules are built on stale stock.',
        cohorts: ['3pl', 'logistics'],
        signalCount: 16,
        importanceScore: 0.78,
        tags: ['StaaS', '3PL', 'logistics'],
        trend: 'growing',
        quotes: [
          "Our 3PL StaaS inventory is still yesterday's when we release the afternoon dock wave.",
          'Need near-real-time StaaS stock for logistics warehouses, not retail store sync.',
        ],
      },
    ]

    const painPoints = req.body?.painPoints?.length ? req.body.painPoints : defaults
    const keepLabels = painPoints.map((p) => p.label)

    // Remove every other pain point / demo signal so the board stays to these two
    await query(
      `DELETE FROM graph_nodes
       WHERE kind = 'PAIN_POINT'
         AND label <> ALL($1::text[])`,
      [keepLabels],
    )
    await query(
      `DELETE FROM graph_nodes
       WHERE kind = 'CUSTOMER_SIGNAL'
         AND COALESCE(metadata->>'painPointLabel','') <> ALL($1::text[])`,
      [keepLabels],
    )

    const created: number[] = []
    for (const pp of painPoints) {
      const meta = {
        demo: true,
        signalCount: pp.signalCount ?? 10,
        importanceScore: pp.importanceScore ?? 0.5,
        cohorts: pp.cohorts ?? [],
        tags: pp.tags ?? [],
        trend: pp.trend ?? 'steady',
        quotes: pp.quotes ?? [],
      }
      const row = await queryOne<{ id: number }>(
        `
        INSERT INTO graph_nodes (kind, label, description, metadata, written_by_agent, trace_id)
        VALUES ('PAIN_POINT', $1, $2, $3::jsonb, 'studio-demo', $4)
        ON CONFLICT (workspace_id, kind, label) DO UPDATE SET
          description = EXCLUDED.description,
          metadata = EXCLUDED.metadata,
          written_by_agent = EXCLUDED.written_by_agent,
          updated_at = NOW()
        RETURNING id
      `,
        [pp.label, pp.description, JSON.stringify(meta), randomUUID()],
      )
      if (row) created.push(row.id)

      // Seed a few CUSTOMER_SIGNAL rows for realism (linked via metadata)
      for (const quote of (pp.quotes ?? []).slice(0, 3)) {
        await query(
          `
          INSERT INTO graph_nodes (kind, label, description, metadata, written_by_agent, trace_id)
          VALUES (
            'CUSTOMER_SIGNAL',
            $1,
            $2,
            $3::jsonb,
            'studio-demo',
            $4
          )
          ON CONFLICT (workspace_id, kind, label) DO UPDATE SET
            description = EXCLUDED.description,
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
        `,
          [
            quote.slice(0, 80),
            quote,
            JSON.stringify({
              demo: true,
              painPointLabel: pp.label,
              cohort: pp.cohorts?.[0] ?? 'demo',
              type: 'pain_point',
            }),
            randomUUID(),
          ],
        )
      }
    }

    return { seeded: created.length, ids: created }
  })

  app.post<{ Body: { painPointId: number; label: string } }>('/studio/start-work', async (req, reply) => {
    const { painPointId, label } = req.body
    if (!painPointId) return reply.status(400).send({ error: 'painPointId required' })

    const cycle = await queryOne<{ id: string }>(
      `INSERT INTO cycles (label, workspace_id, current_stage, feature_id, metadata)
       VALUES ($1, 'default', 'INTAKE', NULL, $2::jsonb) RETURNING id`,
      [label || `Work on pain point ${painPointId}`, JSON.stringify({ painPointId, status: 'in_progress' })],
    )

    try {
      const bcAdapter = await createHttpAdapter(opts.platformUrl, BUSINESS_CASE_MANIFEST)
      const agent = new BusinessCaseAgent(bcAdapter, opts.llm)
      const pp = await queryOne<{ id: number; label: string }>(
        `SELECT id, label FROM graph_nodes WHERE id=$1`,
        [painPointId],
      )
      if (pp) {
        const result = await agent.run({
          painPointIds: [pp.id],
          painPointLabels: [pp.label],
          cycleId: cycle!.id,
        })
        await query(`UPDATE cycles SET feature_id=$1, metadata = metadata || $2::jsonb WHERE id=$3`, [
          result.featureId,
          JSON.stringify({ briefId: result.briefId, featureId: result.featureId }),
          cycle!.id,
        ])
      }
    } catch (err) {
      console.warn('[Studio] Business case handoff soft-failed:', err)
    }

    await query(
      `UPDATE graph_nodes SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id=$2`,
      [JSON.stringify({ cycleId: cycle!.id, workStatus: 'in_progress' }), painPointId],
    )

    return { cycleId: cycle!.id, status: 'in_progress' }
  })

  type BriefJson = {
    title?: string
    problemStatement?: string
    customerSegment?: string
    evidenceSummary?: string
    isDuplicate?: boolean
    duplicateOf?: string | null
    recommendation?: string
    mergeDecision?: string | null
  }

  type CaseStatusKey =
    | 'needs_review'
    | 'draft'
    | 'sizing'
    | 'awaiting_decision'
    | 'admitted'
    | 'deferred'
    | 'rejected'

  const CASE_STATUS_LABELS: Record<CaseStatusKey, string> = {
    needs_review: 'Needs your review',
    draft: 'Draft',
    sizing: 'Sizing in progress',
    awaiting_decision: 'Awaiting decision',
    admitted: '✓ Admitted',
    deferred: '↩ Deferred',
    rejected: '✗ Rejected',
  }

  function deriveBusinessCaseStatus(args: {
    brief: BriefJson
    featureMeta: Record<string, unknown>
    hasImpactNode: boolean
    hasPacket?: boolean
    decision?: string | null
  }): CaseStatusKey {
    const decision = (args.decision ?? '').toLowerCase()
    if (decision === 'admit') return 'admitted'
    if (decision === 'defer') return 'deferred'
    if (decision === 'reject') return 'rejected'
    if (args.brief.isDuplicate && !args.brief.mergeDecision) return 'needs_review'
    if (!args.featureMeta?.sentForSizing && !args.hasImpactNode) return 'draft'
    if (args.hasPacket) return 'awaiting_decision'
    return 'sizing'
  }

  function isSentForSizing(statusKey: CaseStatusKey, featureMeta: Record<string, unknown>) {
    return (
      featureMeta.sentForSizing === true ||
      statusKey === 'sizing' ||
      statusKey === 'awaiting_decision' ||
      statusKey === 'admitted' ||
      statusKey === 'deferred' ||
      statusKey === 'rejected'
    )
  }

  app.get('/studio/business-cases', async () => {
    const rows = await query<{
      feature_id: number
      title: string
      feature_meta: Record<string, unknown>
      brief_id: number | null
      brief_json: string | null
      created_at: string
      pain_point_count: string
      has_impact: boolean
      has_packet: boolean
      decision: string | null
      value_meta: Record<string, unknown> | null
      value_json: string | null
      effort_meta: Record<string, unknown> | null
      effort_json: string | null
      gtm_meta: Record<string, unknown> | null
      gtm_json: string | null
    }>(`
      SELECT
        f.id as feature_id,
        f.label as title,
        f.metadata as feature_meta,
        b.id as brief_id,
        b.description as brief_json,
        f.created_at,
        (SELECT COUNT(*)::text FROM graph_edges ge
           JOIN graph_nodes pp ON pp.id = ge.from_node_id AND pp.kind='PAIN_POINT'
           WHERE ge.to_node_id = f.id AND ge.kind='MOTIVATES') as pain_point_count,
        EXISTS (
          SELECT 1 FROM graph_edges gei
          JOIN graph_nodes n ON n.id = gei.from_node_id OR n.id = gei.to_node_id
          WHERE (gei.from_node_id = f.id OR gei.to_node_id = f.id)
            AND n.kind IN ('BUSINESS_IMPACT', 'DEV_IMPACT')
        ) as has_impact,
        EXISTS (
          SELECT 1 FROM graph_nodes p
          JOIN graph_edges ge ON ge.from_node_id = p.id AND ge.kind='FUNDED_BY'
          WHERE ge.to_node_id = f.id AND p.kind='PORTFOLIO_PACKET'
        ) as has_packet,
        (
          SELECT dr.metadata->>'decision' FROM graph_nodes dr
          WHERE dr.kind='DECISION_RECORD'
            AND dr.metadata->>'gate'='PORTFOLIO_GATE'
            AND (
              (dr.description::jsonb->>'featureId')::int = f.id
              OR (dr.metadata->>'cycleId') IN (SELECT id::text FROM cycles WHERE feature_id = f.id)
              OR EXISTS (
                SELECT 1 FROM graph_edges ge
                WHERE ge.from_node_id = dr.id AND ge.to_node_id = f.id
                  AND ge.kind IN ('APPROVES','DEFERRED','REJECTS')
              )
            )
          ORDER BY dr.created_at DESC LIMIT 1
        ) as decision,
        (
          SELECT bi.metadata FROM graph_nodes bi
          JOIN graph_edges ge ON ge.from_node_id = bi.id AND ge.kind='ESTIMATES'
          WHERE ge.to_node_id = f.id AND bi.kind='BUSINESS_IMPACT'
          ORDER BY bi.created_at DESC LIMIT 1
        ) as value_meta,
        (
          SELECT bi.description FROM graph_nodes bi
          JOIN graph_edges ge ON ge.from_node_id = bi.id AND ge.kind='ESTIMATES'
          WHERE ge.to_node_id = f.id AND bi.kind='BUSINESS_IMPACT'
          ORDER BY bi.created_at DESC LIMIT 1
        ) as value_json,
        (
          SELECT di.metadata FROM graph_nodes di
          JOIN graph_edges ge ON ge.from_node_id = di.id AND ge.kind='ESTIMATES'
          WHERE ge.to_node_id = f.id AND di.kind='DEV_IMPACT'
          ORDER BY di.created_at DESC LIMIT 1
        ) as effort_meta,
        (
          SELECT di.description FROM graph_nodes di
          JOIN graph_edges ge ON ge.from_node_id = di.id AND ge.kind='ESTIMATES'
          WHERE ge.to_node_id = f.id AND di.kind='DEV_IMPACT'
          ORDER BY di.created_at DESC LIMIT 1
        ) as effort_json,
        (
          SELECT g.metadata FROM graph_nodes g
          JOIN graph_edges ge ON ge.from_node_id = g.id AND ge.kind IN ('INFORMS','ADDRESSES')
          WHERE ge.to_node_id = f.id AND g.kind='GTM_PROJECTION'
          ORDER BY g.created_at DESC LIMIT 1
        ) as gtm_meta,
        (
          SELECT g.description FROM graph_nodes g
          JOIN graph_edges ge ON ge.from_node_id = g.id AND ge.kind IN ('INFORMS','ADDRESSES')
          WHERE ge.to_node_id = f.id AND g.kind='GTM_PROJECTION'
          ORDER BY g.created_at DESC LIMIT 1
        ) as gtm_json
      FROM graph_nodes f
      LEFT JOIN graph_edges ge2 ON ge2.to_node_id = f.id AND ge2.kind = 'MOTIVATES'
      LEFT JOIN graph_nodes b ON b.kind='BRIEF' AND b.id = ge2.from_node_id
      WHERE f.kind = 'FEATURE'
        AND COALESCE(f.metadata->>'status', '') <> 'merged'
      ORDER BY f.created_at DESC
    `)

    // Deduplicate features that matched multiple MOTIVATES edges (prefer BRIEF join)
    const byFeature = new Map<number, (typeof rows)[0]>()
    for (const row of rows) {
      const existing = byFeature.get(row.feature_id)
      if (!existing || (row.brief_id && !existing.brief_id)) {
        byFeature.set(row.feature_id, row)
      }
    }

    return [...byFeature.values()].map((row) => {
      let brief: BriefJson = {}
      try {
        brief = row.brief_json ? (JSON.parse(row.brief_json) as BriefJson) : {}
      } catch {
        brief = {}
      }
      const statusKey = deriveBusinessCaseStatus({
        brief,
        featureMeta: row.feature_meta ?? {},
        hasImpactNode: !!row.has_impact,
        hasPacket: !!row.has_packet,
        decision: row.decision,
      })
      let valueLow: number | null = null
      let valueHigh: number | null = null
      let valuePeriod: string | null = null
      let valueCurrency: string | null = null
      try {
        const v = row.value_json ? (JSON.parse(row.value_json) as Record<string, unknown>) : {}
        const meta = row.value_meta ?? {}
        valueLow = Number(meta.valueLow ?? v.valueLow)
        valueHigh = Number(meta.valueHigh ?? v.valueHigh)
        valuePeriod = typeof v.valuePeriod === 'string' ? v.valuePeriod : null
        valueCurrency =
          typeof meta.valueCurrency === 'string'
            ? meta.valueCurrency
            : typeof v.valueCurrency === 'string'
              ? v.valueCurrency
              : 'EUR'
        if (!Number.isFinite(valueLow!)) valueLow = null
        if (!Number.isFinite(valueHigh!)) valueHigh = null
      } catch {
        /* ignore */
      }
      let effortLow: number | null = null
      let effortHigh: number | null = null
      try {
        const e = row.effort_json ? (JSON.parse(row.effort_json) as Record<string, unknown>) : {}
        const em = row.effort_meta ?? {}
        effortLow = Number(em.effortWeeksLow ?? e.effortWeeksLow)
        effortHigh = Number(em.effortWeeksHigh ?? e.effortWeeksHigh)
        if (!Number.isFinite(effortLow!)) effortLow = null
        if (!Number.isFinite(effortHigh!)) effortHigh = null
      } catch {
        /* ignore */
      }
      let topSegment: string | null = null
      try {
        const gm = row.gtm_meta ?? {}
        if (typeof gm.topSegment === 'string' && gm.topSegment) {
          topSegment = gm.topSegment
        } else if (row.gtm_json) {
          const g = JSON.parse(row.gtm_json) as {
            segments?: Array<{ name?: string; fit?: string }>
          }
          const high = g.segments?.find((s) => s.fit === 'high')
          topSegment = high?.name ?? g.segments?.[0]?.name ?? null
        }
      } catch {
        topSegment = null
      }
      const featureMeta = row.feature_meta ?? {}
      return {
        feature_id: row.feature_id,
        title: row.title,
        brief_id: row.brief_id,
        status: CASE_STATUS_LABELS[statusKey],
        status_key: statusKey,
        pain_point_count: Number(row.pain_point_count ?? 0),
        created_at: row.created_at,
        isDuplicate: !!brief.isDuplicate && !brief.mergeDecision,
        value_low: valueLow,
        value_high: valueHigh,
        value_period: valuePeriod,
        value_currency: valueCurrency,
        effort_low: effortLow,
        effort_high: effortHigh,
        top_segment: topSegment,
        sent_for_sizing: isSentForSizing(statusKey, featureMeta),
      }
    })
  })

  app.get<{ Params: { id: string } }>('/studio/business-cases/:id', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    if (!Number.isFinite(featureId)) return reply.status(400).send({ error: 'invalid id' })

    const row = await queryOne<{
      feature_id: number
      title: string
      feature_meta: Record<string, unknown>
      brief_id: number
      brief_json: string
      duplicate_feature_id: number | null
    }>(
      `
      SELECT f.id as feature_id, f.label as title, f.metadata as feature_meta,
             b.id as brief_id, b.description as brief_json,
             (SELECT ge.to_node_id FROM graph_edges ge
               WHERE ge.from_node_id = f.id AND ge.kind='DUPLICATE_OF' LIMIT 1) as duplicate_feature_id
      FROM graph_nodes f
      JOIN graph_edges ge ON ge.to_node_id = f.id AND ge.kind = 'MOTIVATES'
      JOIN graph_nodes b ON b.id = ge.from_node_id AND b.kind = 'BRIEF'
      WHERE f.id = $1
      LIMIT 1
    `,
      [featureId],
    )
    if (!row) return reply.status(404).send({ error: 'Business case not found' })

    let brief: BriefJson = {}
    try {
      brief = JSON.parse(row.brief_json) as BriefJson
    } catch {
      brief = {}
    }

    const hasImpact = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM graph_edges gei
         JOIN graph_nodes n ON n.id = gei.from_node_id OR n.id = gei.to_node_id
         WHERE (gei.from_node_id = $1 OR gei.to_node_id = $1)
           AND n.kind IN ('BUSINESS_IMPACT', 'DEV_IMPACT')
       ) as exists`,
      [featureId],
    )

    const hasPacket = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM graph_nodes p
         JOIN graph_edges ge ON ge.from_node_id = p.id AND ge.kind='FUNDED_BY'
         WHERE ge.to_node_id = $1 AND p.kind='PORTFOLIO_PACKET'
       ) as exists`,
      [featureId],
    )

    const decisionRow = await queryOne<{ decision: string }>(
      `SELECT metadata->>'decision' as decision FROM graph_nodes dr
       WHERE kind='DECISION_RECORD'
         AND metadata->>'gate'='PORTFOLIO_GATE'
         AND (
           (description::jsonb->>'featureId')::int = $1
           OR (metadata->>'cycleId') IN (SELECT id::text FROM cycles WHERE feature_id = $1)
           OR EXISTS (
             SELECT 1 FROM graph_edges ge
             WHERE ge.from_node_id = dr.id AND ge.to_node_id = $1
               AND ge.kind IN ('APPROVES','DEFERRED','REJECTS')
           )
         )
       ORDER BY created_at DESC LIMIT 1`,
      [featureId],
    )

    const statusKey = deriveBusinessCaseStatus({
      brief,
      featureMeta: row.feature_meta ?? {},
      hasImpactNode: !!hasImpact?.exists,
      hasPacket: !!hasPacket?.exists,
      decision: decisionRow?.decision,
    })

    const featureMeta = row.feature_meta ?? {}
    return {
      feature_id: row.feature_id,
      title: row.title,
      brief_id: row.brief_id,
      brief,
      status: CASE_STATUS_LABELS[statusKey],
      status_key: statusKey,
      duplicate_feature_id: row.duplicate_feature_id,
      feature_meta: featureMeta,
      sent_for_sizing: isSentForSizing(statusKey, featureMeta),
    }
  })

  app.post<{ Body: { painPointIds: number[] } }>('/studio/business-cases/generate', async (req, reply) => {
    const painPointIds = req.body?.painPointIds ?? []
    if (!painPointIds.length) return reply.status(400).send({ error: 'painPointIds required' })

    const painPoints = await query<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id = ANY($1::int[]) AND kind='PAIN_POINT'`,
      [painPointIds],
    )
    if (!painPoints.length) return reply.status(404).send({ error: 'Pain points not found' })

    const label = painPoints.map((p) => p.label).join(' · ').slice(0, 120)
    const cycle = await queryOne<{ id: string }>(
      `INSERT INTO cycles (label, workspace_id, current_stage, feature_id, metadata)
       VALUES ($1, 'default', 'INTAKE', NULL, $2::jsonb) RETURNING id`,
      [
        label,
        JSON.stringify({ painPointIds, status: 'in_progress', source: 'business-cases/generate' }),
      ],
    )

    const bcAdapter = await createHttpAdapter(opts.platformUrl, BUSINESS_CASE_MANIFEST)
    const agent = new BusinessCaseAgent(bcAdapter, opts.llm)
    const result = await agent.run({
      painPointIds: painPoints.map((p) => p.id),
      painPointLabels: painPoints.map((p) => p.label),
      cycleId: cycle!.id,
    })

    await query(`UPDATE cycles SET feature_id=$1, metadata = metadata || $2::jsonb WHERE id=$3`, [
      result.featureId,
      JSON.stringify({ briefId: result.briefId, featureId: result.featureId }),
      cycle!.id,
    ])

    for (const pp of painPoints) {
      await query(
        `UPDATE graph_nodes SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id=$2`,
        [
          JSON.stringify({
            cycleId: cycle!.id,
            workStatus: 'in_progress',
            featureId: result.featureId,
          }),
          pp.id,
        ],
      )
    }

    return { briefId: result.briefId, featureId: result.featureId, cycleId: cycle!.id }
  })

  app.patch<{ Params: { id: string }; Body: { field: string; value: string } }>(
    '/studio/business-cases/:id/field',
    async (req, reply) => {
      const featureId = parseInt(req.params.id, 10)
      const { field, value } = req.body ?? {}
      const allowed = new Set(['problemStatement', 'customerSegment', 'title'])
      if (!allowed.has(field)) return reply.status(400).send({ error: 'field not editable' })

      const brief = await queryOne<{ id: number; description: string }>(
        `SELECT b.id, b.description FROM graph_nodes b
         JOIN graph_edges ge ON ge.from_node_id = b.id AND ge.kind='MOTIVATES'
         WHERE ge.to_node_id = $1 AND b.kind='BRIEF' LIMIT 1`,
        [featureId],
      )
      if (!brief) return reply.status(404).send({ error: 'Brief not found' })

      const data = JSON.parse(brief.description || '{}') as BriefJson
      ;(data as Record<string, unknown>)[field] = value
      await query(`UPDATE graph_nodes SET description = $1, updated_at = NOW() WHERE id = $2`, [
        JSON.stringify(data),
        brief.id,
      ])
      if (field === 'title') {
        await query(`UPDATE graph_nodes SET label = $1, updated_at = NOW() WHERE id = $2`, [
          value.slice(0, 120),
          featureId,
        ])
      }
      return { saved: true }
    },
  )

  app.post<{ Params: { id: string }; Body: { mergeIntoFeatureId?: number } }>(
    '/studio/business-cases/:id/merge',
    async (req, reply) => {
      const featureId = parseInt(req.params.id, 10)
      let mergeInto = req.body?.mergeIntoFeatureId

      if (!mergeInto) {
        const dup = await queryOne<{ to_node_id: number }>(
          `SELECT to_node_id FROM graph_edges WHERE from_node_id=$1 AND kind='DUPLICATE_OF' LIMIT 1`,
          [featureId],
        )
        mergeInto = dup?.to_node_id
      }
      if (!mergeInto) {
        const brief = await queryOne<{ description: string }>(
          `SELECT b.description FROM graph_nodes b
           JOIN graph_edges ge ON ge.from_node_id = b.id AND ge.kind='MOTIVATES'
           WHERE ge.to_node_id = $1 AND b.kind='BRIEF' LIMIT 1`,
          [featureId],
        )
        const data = JSON.parse(brief?.description || '{}') as BriefJson
        if (data.duplicateOf) {
          const match = await queryOne<{ id: number }>(
            `SELECT id FROM graph_nodes WHERE kind='FEATURE' AND label=$1
               AND COALESCE(metadata->>'status','') <> 'merged' LIMIT 1`,
            [data.duplicateOf],
          )
          mergeInto = match?.id
        }
      }
      if (!mergeInto) return reply.status(400).send({ error: 'No matching idea to combine with' })

      await query(
        `UPDATE graph_nodes SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"status":"merged"}'::jsonb, updated_at=NOW() WHERE id=$1`,
        [featureId],
      )
      await query(
        `
        INSERT INTO graph_edges (from_node_id, to_node_id, kind)
        SELECT from_node_id, $2, kind FROM graph_edges
        WHERE to_node_id=$1 AND kind='MOTIVATES'
        ON CONFLICT DO NOTHING
      `,
        [featureId, mergeInto],
      )

      const brief = await queryOne<{ id: number; description: string }>(
        `SELECT b.id, b.description FROM graph_nodes b
         JOIN graph_edges ge ON ge.from_node_id = b.id AND ge.kind='MOTIVATES'
         WHERE ge.to_node_id = $1 AND b.kind='BRIEF' LIMIT 1`,
        [featureId],
      )
      if (brief) {
        const data = JSON.parse(brief.description || '{}') as BriefJson
        data.mergeDecision = 'merged'
        await query(`UPDATE graph_nodes SET description=$1 WHERE id=$2`, [JSON.stringify(data), brief.id])
      }

      return { merged: true, mergeIntoFeatureId: mergeInto }
    },
  )

  app.post<{ Params: { id: string } }>('/studio/business-cases/:id/dismiss-duplicate', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const brief = await queryOne<{ id: number; description: string }>(
      `SELECT b.id, b.description FROM graph_nodes b
       JOIN graph_edges ge ON ge.from_node_id = b.id AND ge.kind='MOTIVATES'
       WHERE ge.to_node_id = $1 AND b.kind='BRIEF' LIMIT 1`,
      [featureId],
    )
    if (!brief) return reply.status(404).send({ error: 'Brief not found' })
    const data = JSON.parse(brief.description || '{}') as BriefJson
    data.isDuplicate = false
    data.mergeDecision = 'dismissed'
    await query(`UPDATE graph_nodes SET description=$1, metadata = COALESCE(metadata,'{}'::jsonb) || '{"isDuplicate":false}'::jsonb WHERE id=$2`, [
      JSON.stringify(data),
      brief.id,
    ])
    return { dismissed: true }
  })

  app.post<{ Params: { id: string } }>('/studio/business-cases/:id/send', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{ id: number }>(
      `SELECT id FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })
    await query(
      `UPDATE graph_nodes SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"sentForSizing":true}'::jsonb, updated_at=NOW() WHERE id=$1`,
      [featureId],
    )
    return { sent: true }
  })

  async function loadBriefForFeature(featureId: number) {
    return queryOne<{ id: number; label: string; description: string }>(
      `SELECT b.id, b.label, b.description FROM graph_nodes b
       JOIN graph_edges ge ON ge.from_node_id = b.id AND ge.kind='MOTIVATES'
       WHERE ge.to_node_id = $1 AND b.kind='BRIEF' LIMIT 1`,
      [featureId],
    )
  }

  app.get<{ Params: { id: string } }>('/studio/business-cases/:id/value', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    if (!Number.isFinite(featureId)) return reply.status(400).send({ error: 'invalid id' })

    const row = await queryOne<{
      id: number
      description: string
      created_at: string
      metadata: Record<string, unknown>
    }>(
      `
      SELECT b.id, b.description, b.created_at, b.metadata
      FROM graph_nodes b
      JOIN graph_edges ge ON ge.from_node_id = b.id AND ge.kind = 'ESTIMATES'
      WHERE ge.to_node_id = $1 AND b.kind = 'BUSINESS_IMPACT'
      ORDER BY b.created_at DESC LIMIT 1
    `,
      [featureId],
    )

    const calibration = await query<{ metadata: Record<string, unknown>; created_at: string; description: string }>(
      `SELECT metadata, created_at, description FROM graph_nodes
       WHERE kind='CALIBRATION_RECORD' ORDER BY created_at DESC LIMIT 5`,
    )

    if (!row) {
      return { assessment: null, calibration }
    }

    let data: Record<string, unknown> = {}
    try {
      data = JSON.parse(row.description || '{}') as Record<string, unknown>
    } catch {
      data = {}
    }

    return {
      assessment: {
        id: row.id,
        created_at: row.created_at,
        metadata: row.metadata ?? {},
        data,
      },
      calibration,
    }
  })

  app.post<{ Params: { id: string }; Body: { assumptions?: string[] } }>(
    '/studio/business-cases/:id/estimate-value',
    async (req, reply) => {
      const featureId = parseInt(req.params.id, 10)
      const brief = await loadBriefForFeature(featureId)
      if (!brief) return reply.status(404).send({ error: 'Brief not found for this case' })

      const feature = await queryOne<{ metadata: Record<string, unknown> }>(
        `SELECT metadata FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
        [featureId],
      )
      if (feature?.metadata?.sentForSizing !== true) {
        await query(
          `UPDATE graph_nodes SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"sentForSizing":true}'::jsonb WHERE id=$1`,
          [featureId],
        )
      }

      const cycle = await queryOne<{ id: string }>(
        `SELECT id FROM cycles WHERE feature_id=$1 ORDER BY created_at DESC LIMIT 1`,
        [featureId],
      )

      const adapter = await createHttpAdapter(opts.platformUrl, BUSINESS_VALUE_MANIFEST)
      const agent = new BusinessValueAgent(adapter, opts.llm)
      const result = await agent.run({
        briefId: brief.id,
        briefLabel: brief.label,
        featureId,
        cycleId: cycle?.id,
        humanAdjustedAssumptions: req.body?.assumptions,
      })
      return result
    },
  )

  app.post<{ Params: { id: string }; Body: { assumptions: string[] } }>(
    '/studio/business-cases/:id/value/adjust',
    async (req, reply) => {
      const featureId = parseInt(req.params.id, 10)
      const assumptions = req.body?.assumptions ?? []
      if (!assumptions.length) return reply.status(400).send({ error: 'assumptions required' })

      const brief = await loadBriefForFeature(featureId)
      if (!brief) return reply.status(404).send({ error: 'Brief not found for this case' })

      const cycle = await queryOne<{ id: string }>(
        `SELECT id FROM cycles WHERE feature_id=$1 ORDER BY created_at DESC LIMIT 1`,
        [featureId],
      )

      const adapter = await createHttpAdapter(opts.platformUrl, BUSINESS_VALUE_MANIFEST)
      const agent = new BusinessValueAgent(adapter, opts.llm)
      const result = await agent.run({
        briefId: brief.id,
        briefLabel: brief.label,
        featureId,
        cycleId: cycle?.id,
        humanAdjustedAssumptions: assumptions,
      })
      return result
    },
  )

  async function loadLatestEffort(featureId: number) {
    return queryOne<{ id: number; description: string; created_at: string; metadata: Record<string, unknown> }>(
      `SELECT d.id, d.description, d.created_at, d.metadata
       FROM graph_nodes d
       JOIN graph_edges ge ON ge.from_node_id = d.id AND ge.kind = 'ESTIMATES'
       WHERE ge.to_node_id = $1 AND d.kind = 'DEV_IMPACT'
       ORDER BY d.created_at DESC LIMIT 1`,
      [featureId],
    )
  }

  app.get<{ Params: { id: string } }>('/studio/business-cases/:id/effort', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    if (!Number.isFinite(featureId)) return reply.status(400).send({ error: 'invalid id' })

    const row = await loadLatestEffort(featureId)
    if (!row) return { assessment: null }

    let data: Record<string, unknown> = {}
    try {
      data = JSON.parse(row.description || '{}') as Record<string, unknown>
    } catch {
      data = {}
    }

    return {
      assessment: {
        id: row.id,
        created_at: row.created_at,
        metadata: row.metadata ?? {},
        data,
      },
    }
  })

  app.post<{ Params: { id: string } }>('/studio/business-cases/:id/estimate-effort', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const brief = await loadBriefForFeature(featureId)
    if (!brief) return reply.status(404).send({ error: 'Brief not found for this case' })

    const feature = await queryOne<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (feature?.metadata?.sentForSizing !== true) {
      await query(
        `UPDATE graph_nodes SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"sentForSizing":true}'::jsonb WHERE id=$1`,
        [featureId],
      )
    }

    const cycle = await queryOne<{ id: string }>(
      `SELECT id FROM cycles WHERE feature_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [featureId],
    )

    const adapter = await createHttpAdapter(opts.platformUrl, ENGINEERING_ESTIMATION_MANIFEST)
    const agent = new EngineeringEstimationAgent(adapter, opts.llm)
    return agent.run({
      briefId: brief.id,
      featureId,
      cycleId: cycle?.id,
    })
  })

  app.patch<{ Params: { id: string }; Body: { riskIndex: number } }>(
    '/studio/business-cases/:id/effort/risk-addressed',
    async (req, reply) => {
      const featureId = parseInt(req.params.id, 10)
      const riskIndex = Number(req.body?.riskIndex)
      if (!Number.isFinite(riskIndex) || riskIndex < 0) {
        return reply.status(400).send({ error: 'riskIndex required' })
      }

      const assessment = await loadLatestEffort(featureId)
      if (!assessment) return reply.status(404).send({ error: 'Effort assessment not found' })

      const data = JSON.parse(assessment.description || '{}') as {
        addressedRiskIndices?: number[]
        technicalRisks?: string[]
      }
      const risks = data.technicalRisks ?? []
      if (riskIndex >= risks.length) {
        return reply.status(400).send({ error: 'riskIndex out of range' })
      }
      const set = new Set(data.addressedRiskIndices ?? [])
      set.add(riskIndex)
      data.addressedRiskIndices = [...set].sort((a, b) => a - b)

      await query(`UPDATE graph_nodes SET description = $1, updated_at = NOW() WHERE id = $2`, [
        JSON.stringify(data),
        assessment.id,
      ])
      return { saved: true, addressedRiskIndices: data.addressedRiskIndices }
    },
  )

  app.post<{ Params: { id: string } }>('/studio/business-cases/:id/effort/reestimate', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const brief = await loadBriefForFeature(featureId)
    if (!brief) return reply.status(404).send({ error: 'Brief not found for this case' })

    const previous = await loadLatestEffort(featureId)
    let resolvedRisks: string[] = []
    if (previous) {
      try {
        const data = JSON.parse(previous.description || '{}') as {
          technicalRisks?: string[]
          addressedRiskIndices?: number[]
        }
        const risks = data.technicalRisks ?? []
        resolvedRisks = (data.addressedRiskIndices ?? [])
          .map((i) => risks[i])
          .filter((r): r is string => typeof r === 'string' && r.length > 0)
      } catch {
        resolvedRisks = []
      }
    }

    const cycle = await queryOne<{ id: string }>(
      `SELECT id FROM cycles WHERE feature_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [featureId],
    )

    const adapter = await createHttpAdapter(opts.platformUrl, ENGINEERING_ESTIMATION_MANIFEST)
    const agent = new EngineeringEstimationAgent(adapter, opts.llm)
    return agent.run({
      briefId: brief.id,
      featureId,
      cycleId: cycle?.id,
      resolvedRisks,
    })
  })

  async function loadLatestGtm(featureId: number) {
    return queryOne<{
      id: number
      description: string
      created_at: string
      metadata: Record<string, unknown>
    }>(
      `SELECT g.id, g.description, g.created_at, g.metadata
       FROM graph_nodes g
       JOIN graph_edges ge ON ge.from_node_id = g.id AND ge.kind IN ('INFORMS','ADDRESSES')
       WHERE ge.to_node_id = $1 AND g.kind = 'GTM_PROJECTION'
       ORDER BY g.created_at DESC LIMIT 1`,
      [featureId],
    )
  }

  async function loadLatestValueAssessment(featureId: number) {
    return queryOne<{ id: number; description: string }>(
      `SELECT b.id, b.description FROM graph_nodes b
       JOIN graph_edges ge ON ge.from_node_id = b.id AND ge.kind = 'ESTIMATES'
       WHERE ge.to_node_id = $1 AND b.kind = 'BUSINESS_IMPACT'
       ORDER BY b.created_at DESC LIMIT 1`,
      [featureId],
    )
  }

  app.get('/studio/gtm', async () => {
    const cases = await query<{
      feature_id: number
      title: string
      feature_meta: Record<string, unknown>
      has_value: boolean
      gtm_json: string | null
      gtm_meta: Record<string, unknown> | null
    }>(`
      SELECT
        f.id as feature_id,
        f.label as title,
        f.metadata as feature_meta,
        EXISTS (
          SELECT 1 FROM graph_nodes bi
          JOIN graph_edges ge ON ge.from_node_id = bi.id AND ge.kind='ESTIMATES'
          WHERE ge.to_node_id = f.id AND bi.kind='BUSINESS_IMPACT'
        ) as has_value,
        (
          SELECT g.description FROM graph_nodes g
          JOIN graph_edges ge ON ge.from_node_id = g.id AND ge.kind IN ('INFORMS','ADDRESSES')
          WHERE ge.to_node_id = f.id AND g.kind='GTM_PROJECTION'
          ORDER BY g.created_at DESC LIMIT 1
        ) as gtm_json,
        (
          SELECT g.metadata FROM graph_nodes g
          JOIN graph_edges ge ON ge.from_node_id = g.id AND ge.kind IN ('INFORMS','ADDRESSES')
          WHERE ge.to_node_id = f.id AND g.kind='GTM_PROJECTION'
          ORDER BY g.created_at DESC LIMIT 1
        ) as gtm_meta
      FROM graph_nodes f
      WHERE f.kind='FEATURE'
        AND COALESCE(f.metadata->>'status','') <> 'merged'
        AND (
          COALESCE((f.metadata->>'sentForSizing')::boolean, false) = true
          OR EXISTS (
            SELECT 1 FROM graph_nodes bi
            JOIN graph_edges ge ON ge.from_node_id = bi.id AND ge.kind='ESTIMATES'
            WHERE ge.to_node_id = f.id AND bi.kind IN ('BUSINESS_IMPACT','DEV_IMPACT')
          )
        )
      ORDER BY f.created_at DESC
    `)

    return cases.map((row) => {
      let topSegment: string | null = null
      let status: 'Needs value first' | 'Ready to plan' | 'Planned' = 'Needs value first'
      if (row.gtm_json) {
        status = 'Planned'
        try {
          const gm = row.gtm_meta ?? {}
          if (typeof gm.topSegment === 'string') topSegment = gm.topSegment
          else {
            const g = JSON.parse(row.gtm_json) as {
              segments?: Array<{ name?: string; fit?: string }>
            }
            topSegment =
              g.segments?.find((s) => s.fit === 'high')?.name ?? g.segments?.[0]?.name ?? null
          }
        } catch {
          /* ignore */
        }
      } else if (row.has_value) {
        status = 'Ready to plan'
      }
      return {
        feature_id: row.feature_id,
        title: row.title,
        status,
        has_value: !!row.has_value,
        top_segment: topSegment,
      }
    })
  })

  app.get<{ Params: { id: string } }>('/studio/gtm/:id', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    if (!Number.isFinite(featureId)) return reply.status(400).send({ error: 'invalid id' })

    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })

    const value = await loadLatestValueAssessment(featureId)
    const gtm = await loadLatestGtm(featureId)

    let projection: Record<string, unknown> | null = null
    if (gtm) {
      try {
        projection = JSON.parse(gtm.description || '{}') as Record<string, unknown>
      } catch {
        projection = {}
      }
    }

    return {
      feature_id: feature.id,
      title: feature.label,
      has_value: !!value,
      value_assessment_id: value?.id ?? null,
      projection: gtm
        ? {
            id: gtm.id,
            created_at: gtm.created_at,
            metadata: gtm.metadata ?? {},
            data: projection,
          }
        : null,
    }
  })

  app.post<{ Params: { id: string } }>('/studio/gtm/:id/plan', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })

    const assessment = await loadLatestValueAssessment(featureId)
    if (!assessment) {
      return reply.status(400).send({ error: 'No business value assessment exists yet' })
    }

    const cycle = await queryOne<{ id: string }>(
      `SELECT id FROM cycles WHERE feature_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [featureId],
    )

    const adapter = await createHttpAdapter(opts.platformUrl, GTM_STRATEGY_MANIFEST)
    const agent = new GtmStrategyAgent(adapter, opts.llm)
    return agent.run({
      featureId,
      featureLabel: feature.label,
      assessmentId: assessment.id,
      cycleId: cycle?.id,
    })
  })

  app.patch<{ Params: { id: string }; Body: { positioning: string } }>(
    '/studio/gtm/:id/positioning',
    async (req, reply) => {
      const featureId = parseInt(req.params.id, 10)
      const positioning = req.body?.positioning
      if (typeof positioning !== 'string' || !positioning.trim()) {
        return reply.status(400).send({ error: 'positioning required' })
      }

      const projection = await loadLatestGtm(featureId)
      if (!projection) return reply.status(404).send({ error: 'GTM projection not found' })

      const data = JSON.parse(projection.description || '{}') as Record<string, unknown>
      data.positioning = positioning.trim()
      await query(`UPDATE graph_nodes SET description = $1, updated_at = NOW() WHERE id = $2`, [
        JSON.stringify(data),
        projection.id,
      ])
      return { saved: true }
    },
  )

  // ── Portfolio Review (Decide) ─────────────────────────────────────────────

  async function loadLatestPacket(featureId: number) {
    return queryOne<{
      id: number
      description: string
      metadata: Record<string, unknown>
      created_at: string
    }>(
      `SELECT p.id, p.description, p.metadata, p.created_at FROM graph_nodes p
       JOIN graph_edges ge ON ge.from_node_id = p.id AND ge.kind = 'FUNDED_BY'
       WHERE ge.to_node_id = $1 AND p.kind = 'PORTFOLIO_PACKET'
       ORDER BY p.created_at DESC LIMIT 1`,
      [featureId],
    )
  }

  async function ensureCycleForFeature(featureId: number, label: string) {
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM cycles WHERE feature_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [featureId],
    )
    if (existing) return existing
    const created = await queryOne<{ id: string }>(
      `INSERT INTO cycles (label, workspace_id, current_stage, feature_id, metadata)
       VALUES ($1, 'default', 'PORTFOLIO_GATE', $2, $3::jsonb)
       RETURNING id`,
      [label, featureId, JSON.stringify({ featureId, studio: true })],
    )
    return created
  }

  app.get('/team/approvers', async () => {
    return query<{
      user_id: string
      title: string
      name: string
      email: string
    }>(
      `SELECT a.user_id, a.title, u.name, u.email
       FROM studio_approvers a
       JOIN studio_users u ON u.id = a.user_id
       WHERE a.workspace_id='default'
       ORDER BY u.name`,
    )
  })

  app.post<{ Body: { userId: string; title: string } }>('/team/approvers', async (req, reply) => {
    const { userId, title } = req.body ?? {}
    if (!userId || !title?.trim()) {
      return reply.status(400).send({ error: 'userId and title required' })
    }
    await query(
      `INSERT INTO studio_approvers (user_id, title) VALUES ($1,$2)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET title = EXCLUDED.title`,
      [userId, title.trim()],
    )
    return { added: true }
  })

  app.delete<{ Params: { userId: string } }>('/team/approvers/:userId', async (req) => {
    await query(`DELETE FROM studio_approvers WHERE user_id=$1 AND workspace_id='default'`, [
      req.params.userId,
    ])
    return { removed: true }
  })

  app.get('/studio/portfolio', async () => {
    const cases = await query<{
      feature_id: number
      title: string
      has_value: boolean
      has_effort: boolean
      has_gtm: boolean
      packet_json: string | null
      packet_meta: Record<string, unknown> | null
      decision: string | null
    }>(`
      SELECT
        f.id as feature_id,
        f.label as title,
        EXISTS (
          SELECT 1 FROM graph_nodes bi
          JOIN graph_edges ge ON ge.from_node_id = bi.id AND ge.kind='ESTIMATES'
          WHERE ge.to_node_id = f.id AND bi.kind='BUSINESS_IMPACT'
        ) as has_value,
        EXISTS (
          SELECT 1 FROM graph_nodes di
          JOIN graph_edges ge ON ge.from_node_id = di.id AND ge.kind='ESTIMATES'
          WHERE ge.to_node_id = f.id AND di.kind='DEV_IMPACT'
        ) as has_effort,
        EXISTS (
          SELECT 1 FROM graph_nodes g
          JOIN graph_edges ge ON ge.from_node_id = g.id AND ge.kind IN ('INFORMS','ADDRESSES')
          WHERE ge.to_node_id = f.id AND g.kind='GTM_PROJECTION'
        ) as has_gtm,
        (
          SELECT p.description FROM graph_nodes p
          JOIN graph_edges ge ON ge.from_node_id = p.id AND ge.kind='FUNDED_BY'
          WHERE ge.to_node_id = f.id AND p.kind='PORTFOLIO_PACKET'
          ORDER BY p.created_at DESC LIMIT 1
        ) as packet_json,
        (
          SELECT p.metadata FROM graph_nodes p
          JOIN graph_edges ge ON ge.from_node_id = p.id AND ge.kind='FUNDED_BY'
          WHERE ge.to_node_id = f.id AND p.kind='PORTFOLIO_PACKET'
          ORDER BY p.created_at DESC LIMIT 1
        ) as packet_meta,
        (
          SELECT dr.metadata->>'decision' FROM graph_nodes dr
          WHERE dr.kind='DECISION_RECORD'
            AND dr.metadata->>'gate'='PORTFOLIO_GATE'
            AND (
              (dr.description::jsonb->>'featureId')::int = f.id
              OR EXISTS (
                SELECT 1 FROM graph_edges ge
                WHERE ge.from_node_id = dr.id AND ge.to_node_id = f.id
                  AND ge.kind IN ('APPROVES','DEFERRED','REJECTS')
              )
            )
          ORDER BY dr.created_at DESC LIMIT 1
        ) as decision
      FROM graph_nodes f
      WHERE f.kind='FEATURE'
        AND COALESCE(f.metadata->>'status','') <> 'merged'
        AND (
          COALESCE((f.metadata->>'sentForSizing')::boolean, false) = true
          OR EXISTS (
            SELECT 1 FROM graph_nodes bi
            JOIN graph_edges ge ON ge.from_node_id = bi.id AND ge.kind='ESTIMATES'
            WHERE ge.to_node_id = f.id AND bi.kind IN ('BUSINESS_IMPACT','DEV_IMPACT')
          )
        )
      ORDER BY f.created_at DESC
    `)

    return cases.map((row) => {
      let status:
        | 'Needs assessments'
        | 'Ready to assemble'
        | 'Ready for review'
        | 'Decided' = 'Needs assessments'
      let recommendation: string | null = null
      if (row.decision) {
        status = 'Decided'
      } else if (row.packet_json) {
        status = 'Ready for review'
        try {
          const meta = row.packet_meta ?? {}
          if (typeof meta.recommendation === 'string') recommendation = meta.recommendation
          else {
            const p = JSON.parse(row.packet_json) as { recommendation?: string }
            recommendation = p.recommendation ?? null
          }
        } catch {
          /* ignore */
        }
      } else if (row.has_value && row.has_effort && row.has_gtm) {
        status = 'Ready to assemble'
      }
      return {
        feature_id: row.feature_id,
        title: row.title,
        status,
        has_value: !!row.has_value,
        has_effort: !!row.has_effort,
        has_gtm: !!row.has_gtm,
        recommendation,
        decision: row.decision,
      }
    })
  })

  app.get<{ Querystring: { userId?: string } }>(
    '/studio/portfolio/awaiting',
    async (req) => {
      const userId = req.query.userId
      let isApprover = false
      if (userId) {
        const row = await queryOne<{ user_id: string }>(
          `SELECT user_id FROM studio_approvers WHERE user_id=$1 AND workspace_id='default'`,
          [userId],
        )
        isApprover = !!row
      }
      if (!isApprover) return { isApprover: false, count: 0 }

      const row = await queryOne<{ count: string }>(`
        SELECT COUNT(*)::text as count FROM graph_nodes p
        JOIN graph_edges ge ON ge.from_node_id = p.id AND ge.kind='FUNDED_BY'
        WHERE p.kind='PORTFOLIO_PACKET'
          AND NOT EXISTS (
            SELECT 1 FROM graph_nodes d WHERE d.kind='DECISION_RECORD'
              AND (d.metadata->>'gate')='PORTFOLIO_GATE'
              AND (
                (d.description::jsonb->>'featureId')::int = ge.to_node_id
                OR (d.metadata->>'cycleId') IN (
                  SELECT id::text FROM cycles WHERE feature_id = ge.to_node_id
                )
              )
          )
      `)
      return { isApprover: true, count: Number(row?.count ?? 0) }
    },
  )

  app.get<{ Params: { id: string }; Querystring: { userId?: string } }>(
    '/studio/portfolio/:id',
    async (req, reply) => {
      const featureId = parseInt(req.params.id, 10)
      if (!Number.isFinite(featureId)) return reply.status(400).send({ error: 'invalid id' })

      const feature = await queryOne<{ id: number; label: string }>(
        `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
        [featureId],
      )
      if (!feature) return reply.status(404).send({ error: 'Business case not found' })

      const [valueRow, effortRow, gtmRow, packetRow] = await Promise.all([
        loadLatestValueAssessment(featureId),
        loadLatestEffort(featureId),
        loadLatestGtm(featureId),
        loadLatestPacket(featureId),
      ])

      const parseDesc = (raw: string | undefined | null) => {
        if (!raw) return null
        try {
          return JSON.parse(raw) as Record<string, unknown>
        } catch {
          return {}
        }
      }

      const value = valueRow ? parseDesc(valueRow.description) : null
      const effort = effortRow ? parseDesc(effortRow.description) : null
      const gtm = gtmRow ? parseDesc(gtmRow.description) : null
      const packetData = packetRow ? parseDesc(packetRow.description) : null

      const hypNodes = await query<{
        id: number
        description: string
        metadata: Record<string, unknown>
      }>(
        `SELECT vh.id, vh.description, vh.metadata
         FROM graph_nodes vh
         JOIN graph_edges ge ON ge.from_node_id = vh.id AND ge.kind='SUPPORTS'
         JOIN graph_nodes bi ON bi.id = ge.to_node_id AND bi.kind='BUSINESS_IMPACT'
         JOIN graph_edges ge2 ON ge2.from_node_id = bi.id AND ge2.kind='ESTIMATES'
         WHERE ge2.to_node_id = $1 AND vh.kind='VALUE_HYPOTHESIS'
         ORDER BY vh.created_at`,
        [featureId],
      )

      type Hyp = {
        kpi: string
        direction: string
        magnitudePct: number
        timeframeDays: number
        committed?: boolean
      }
      let hypotheses: Hyp[] = hypNodes.map((h) => {
        const d = parseDesc(h.description) as Hyp | null
        return {
          kpi: d?.kpi ?? 'kpi',
          direction: d?.direction ?? 'increase',
          magnitudePct: Number(d?.magnitudePct ?? 0),
          timeframeDays: Number(d?.timeframeDays ?? 90),
          committed: h.metadata?.committed === true,
        }
      })
      if (!hypotheses.length && value && Array.isArray(value.hypotheses)) {
        hypotheses = (value.hypotheses as Hyp[]).map((h) => ({
          ...h,
          committed: false,
        }))
      }

      const approvers = await query<{ user_id: string; title: string }>(
        `SELECT user_id, title FROM studio_approvers WHERE workspace_id='default'`,
      )
      const userId = req.query.userId
      const myTitles = userId
        ? approvers.filter((a) => a.user_id === userId).map((a) => a.title)
        : []
      const isApprover = myTitles.length > 0

      const decisionRow = await queryOne<{
        decision: string
        role: string
        rationale: string
        created_at: string
      }>(
        `SELECT metadata->>'decision' as decision,
                metadata->>'role' as role,
                description::jsonb->>'rationale' as rationale,
                created_at::text
         FROM graph_nodes
         WHERE kind='DECISION_RECORD'
           AND metadata->>'gate'='PORTFOLIO_GATE'
           AND (
             (description::jsonb->>'featureId')::int = $1
             OR EXISTS (
               SELECT 1 FROM graph_edges ge
               WHERE ge.from_node_id = graph_nodes.id AND ge.to_node_id = $1
                 AND ge.kind IN ('APPROVES','DEFERRED','REJECTS')
             )
           )
         ORDER BY created_at DESC LIMIT 1`,
        [featureId],
      )

      return {
        feature_id: feature.id,
        title: feature.label,
        has_value: !!valueRow,
        has_effort: !!effortRow,
        has_gtm: !!gtmRow,
        value_assessment_id: valueRow?.id ?? null,
        effort_assessment_id: effortRow?.id ?? null,
        projection_id: gtmRow?.id ?? null,
        value,
        effort,
        gtm,
        packet: packetRow
          ? {
              id: packetRow.id,
              created_at: packetRow.created_at,
              metadata: packetRow.metadata ?? {},
              data: packetData,
            }
          : null,
        hypotheses,
        is_approver: isApprover,
        my_approver_titles: myTitles,
        approver_titles: [...new Set(approvers.map((a) => a.title))],
        decision: decisionRow
          ? {
              decision: decisionRow.decision,
              role: decisionRow.role,
              rationale: decisionRow.rationale,
              created_at: decisionRow.created_at,
            }
          : null,
      }
    },
  )

  app.post<{ Params: { id: string } }>('/studio/portfolio/:id/assemble', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })

    const [biz, eng, gtm] = await Promise.all([
      loadLatestValueAssessment(featureId),
      loadLatestEffort(featureId),
      loadLatestGtm(featureId),
    ])
    if (!biz || !eng || !gtm) {
      return reply.status(400).send({
        error: 'Value, effort, and GTM assessments are all required before assembling a packet',
        missing: {
          value: !biz,
          effort: !eng,
          gtm: !gtm,
        },
      })
    }

    const cycle = await ensureCycleForFeature(featureId, feature.label)
    const adapter = await createHttpAdapter(opts.platformUrl, PORTFOLIO_ADVISOR_MANIFEST)
    const agent = new PortfolioAdvisorAgent(adapter, opts.llm)
    const result = await agent.assemble({
      featureId,
      businessAssessmentId: biz.id,
      engAssessmentId: eng.id,
      projectionId: gtm.id,
      cycleId: cycle?.id,
    })

    // Opt-in approver notification (reuses notify_big_problems from Settings)
    const settings = await queryOne<{ notify_big_problems: boolean }>(
      `SELECT notify_big_problems FROM studio_settings WHERE workspace_id='default'`,
    )
    if (settings?.notify_big_problems) {
      const approvers = await query<{ email: string; name: string }>(
        `SELECT u.email, u.name FROM studio_approvers a
         JOIN studio_users u ON u.id = a.user_id
         WHERE a.workspace_id='default'`,
      )
      const appUrl = process.env.APP_URL ?? 'http://localhost:3001'
      for (const approver of approvers) {
        // Same pattern as invites — log until an email provider is wired
        console.log(
          `[Studio] Notify ${approver.email}: A business case needs your review — ${appUrl}/portfolio/${featureId}`,
        )
      }
    }

    return result
  })

  app.get('/studio/decisions', async () => {
    const rows = await query<{
      id: number
      label: string
      metadata: Record<string, unknown>
      description: string
      created_at: string
      feature_id: number | null
      feature_title: string | null
    }>(`
      SELECT d.id, d.label, d.metadata, d.description, d.created_at,
             COALESCE(
               c.feature_id,
               NULLIF(d.description::jsonb->>'featureId','')::int
             ) as feature_id,
             COALESCE(
               f.label,
               f2.label
             ) as feature_title
      FROM graph_nodes d
      LEFT JOIN cycles c ON (d.metadata->>'cycleId') = c.id::text
      LEFT JOIN graph_nodes f ON f.id = c.feature_id AND f.kind='FEATURE'
      LEFT JOIN graph_nodes f2 ON f2.id = NULLIF(d.description::jsonb->>'featureId','')::int
        AND f2.kind='FEATURE'
      WHERE d.kind = 'DECISION_RECORD'
        AND (d.metadata->>'gate') = 'PORTFOLIO_GATE'
        AND COALESCE((d.metadata->>'demoRetired')::boolean, false) = false
      ORDER BY d.created_at DESC
    `)

    return rows.map((d) => {
      let rationale = ''
      try {
        const desc = JSON.parse(d.description || '{}') as { rationale?: string }
        rationale = desc.rationale ?? ''
      } catch {
        rationale = ''
      }
      const meta = d.metadata ?? {}
      return {
        id: d.id,
        feature_id: d.feature_id,
        feature_title: d.feature_title ?? d.label,
        decision: (meta.decision as string) ?? null,
        role: (meta.role as string) ?? null,
        rationale: rationale || String(meta.rationale ?? ''),
        created_at: d.created_at,
      }
    })
  })

  app.post<{
    Params: { id: string }
    Body: {
      decision: 'admit' | 'defer' | 'reject'
      role: string
      rationale: string
      userId: string
    }
  }>('/studio/portfolio/:id/decide', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const { decision, role, rationale, userId } = req.body ?? {}
    if (!['admit', 'defer', 'reject'].includes(decision)) {
      return reply.status(400).send({ error: 'decision must be admit, defer, or reject' })
    }
    if (!role?.trim() || !rationale || rationale.trim().length < 10) {
      return reply.status(400).send({ error: 'role and rationale (min 10 chars) required' })
    }
    if (!userId) return reply.status(400).send({ error: 'userId required' })

    const approver = await queryOne<{ title: string }>(
      `SELECT title FROM studio_approvers WHERE user_id=$1 AND workspace_id='default'`,
      [userId],
    )
    if (!approver) {
      return reply.status(403).send({ error: 'Only designated portfolio approvers can decide' })
    }

    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })

    if (!opts.orchestrator) {
      return reply.status(503).send({ error: 'Orchestrator not available' })
    }

    const cycle = await ensureCycleForFeature(featureId, feature.label)
    if (!cycle) return reply.status(500).send({ error: 'Could not ensure cycle' })

    const nodeId = await opts.orchestrator.recordGate(
      cycle.id,
      'PORTFOLIO_GATE',
      decision,
      role.trim(),
      rationale.trim(),
    )

    if (decision === 'admit') {
      await query(
        `
        UPDATE graph_nodes SET metadata = metadata || '{"committed":true}'::jsonb
        WHERE kind='VALUE_HYPOTHESIS'
          AND id IN (
            SELECT ge.from_node_id FROM graph_edges ge
            WHERE ge.kind='SUPPORTS'
              AND ge.to_node_id IN (
                SELECT bi.id FROM graph_nodes bi
                JOIN graph_edges ge2 ON ge2.from_node_id = bi.id AND ge2.kind='ESTIMATES'
                WHERE ge2.to_node_id=$1 AND bi.kind='BUSINESS_IMPACT'
              )
          )
      `,
        [featureId],
      )
      await opts.orchestrator.commitHypotheses(cycle.id)
    }

    const packet = await loadLatestPacket(featureId)
    if (packet) {
      const data = JSON.parse(packet.description || '{}') as Record<string, unknown>
      data.decision = decision
      data.decisionRecordId = nodeId
      data.decidedBy = role.trim()
      data.rationale = rationale.trim()
      await query(
        `UPDATE graph_nodes
         SET description = $1,
             metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
             updated_at = NOW()
         WHERE id = $3`,
        [
          JSON.stringify(data),
          JSON.stringify({ decision, decisionRecordId: nodeId }),
          packet.id,
        ],
      )
    }

    return { nodeId, decision, cycleId: cycle.id }
  })

  // ── Define: Requirements ──────────────────────────────────────────────────

  async function isFeatureAdmitted(featureId: number): Promise<boolean> {
    const row = await queryOne<{ decision: string }>(
      `SELECT metadata->>'decision' as decision FROM graph_nodes dr
       WHERE kind='DECISION_RECORD'
         AND metadata->>'gate'='PORTFOLIO_GATE'
         AND COALESCE((metadata->>'demoRetired')::boolean, false) = false
         AND (
           (description::jsonb->>'featureId')::int = $1
           OR (metadata->>'cycleId') IN (SELECT id::text FROM cycles WHERE feature_id = $1)
           OR EXISTS (
             SELECT 1 FROM graph_edges ge
             WHERE ge.from_node_id = dr.id AND ge.to_node_id = $1
               AND ge.kind IN ('APPROVES','DEFERRED','REJECTS')
           )
         )
       ORDER BY created_at DESC LIMIT 1`,
      [featureId],
    )
    return (row?.decision ?? '').toLowerCase() === 'admit'
  }

  app.get('/studio/requirements', async () => {
    const rows = await query<{
      feature_id: number
      title: string
      story_count: string
    }>(`
      SELECT
        f.id as feature_id,
        f.label as title,
        (
          SELECT COUNT(*)::text FROM graph_nodes us
          JOIN graph_edges ge ON ge.to_node_id = us.id AND ge.kind='REFINES'
          WHERE ge.from_node_id = f.id AND us.kind='USER_STORY'
        ) as story_count
      FROM graph_nodes f
      WHERE f.kind='FEATURE'
        AND COALESCE(f.metadata->>'status','') <> 'merged'
        AND EXISTS (
          SELECT 1 FROM graph_nodes dr
          WHERE dr.kind='DECISION_RECORD'
            AND dr.metadata->>'gate'='PORTFOLIO_GATE'
            AND COALESCE((dr.metadata->>'demoRetired')::boolean, false) = false
            AND LOWER(dr.metadata->>'decision') = 'admit'
            AND (
              (dr.description::jsonb->>'featureId')::int = f.id
              OR (dr.metadata->>'cycleId') IN (SELECT id::text FROM cycles WHERE feature_id = f.id)
              OR EXISTS (
                SELECT 1 FROM graph_edges ge
                WHERE ge.from_node_id = dr.id AND ge.to_node_id = f.id AND ge.kind='APPROVES'
              )
            )
        )
      ORDER BY f.created_at DESC
    `)

    return rows.map((r) => {
      const stories = Number(r.story_count ?? 0)
      return {
        feature_id: r.feature_id,
        title: r.title,
        story_count: stories,
        status: stories > 0 ? 'Stories drafted' : 'Needs requirements',
      }
    })
  })

  app.get<{ Params: { id: string } }>('/studio/requirements/:id', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    if (!Number.isFinite(featureId)) return reply.status(400).send({ error: 'invalid id' })

    const feature = await queryOne<{ id: number; label: string; description: string | null }>(
      `SELECT id, label, description FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })

    const admitted = await isFeatureAdmitted(featureId)
    if (!admitted) {
      return {
        feature_id: feature.id,
        title: feature.label,
        admitted: false,
        stories: [],
        status: 'Not admitted',
      }
    }

    const stories = await query<{
      id: number
      label: string
      description: string | null
    }>(
      `SELECT us.id, us.label, us.description
       FROM graph_nodes us
       JOIN graph_edges ge ON ge.to_node_id = us.id AND ge.kind='REFINES'
       WHERE ge.from_node_id = $1 AND us.kind='USER_STORY'
       ORDER BY us.created_at`,
      [featureId],
    )

    const withCriteria = await Promise.all(
      stories.map(async (s) => {
        const criteria = await query<{
          id: number
          label: string
          description: string | null
        }>(
          `SELECT ac.id, ac.label, ac.description
           FROM graph_nodes ac
           JOIN graph_edges ge ON ge.to_node_id = ac.id AND ge.kind='ACCEPTS'
           WHERE ge.from_node_id = $1 AND ac.kind='ACCEPTANCE_CRITERION'
           ORDER BY ac.created_at`,
          [s.id],
        )
        return {
          id: s.id,
          title: s.label,
          description: s.description ?? '',
          criteria: criteria.map((c) => ({
            id: c.id,
            label: c.label,
            description: c.description ?? '',
          })),
        }
      }),
    )

    return {
      feature_id: feature.id,
      title: feature.label,
      description: feature.description,
      admitted: true,
      status: withCriteria.length > 0 ? 'Stories drafted' : 'Needs requirements',
      stories: withCriteria,
    }
  })

  app.post<{ Params: { id: string } }>('/studio/requirements/:id/draft', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })

    if (!(await isFeatureAdmitted(featureId))) {
      return reply.status(400).send({ error: 'Case must be admitted before drafting requirements' })
    }

    const cycle = await queryOne<{ id: string }>(
      `SELECT id FROM cycles WHERE feature_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [featureId],
    )

    const adapter = await createHttpAdapter(opts.platformUrl, REQUIREMENTS_ANALYST_MANIFEST)
    const agent = new RequirementsAnalystAgent(adapter, opts.llm)
    return agent.run({ featureId, cycleId: cycle?.id })
  })

  async function admittedFeaturesWithCounts() {
    return query<{
      feature_id: number
      title: string
      story_count: string
      concept_count: string
      context_count: string
      note_count: string
      run_count: string
      blocked_count: string
      docs_count: string
    }>(`
      SELECT
        f.id as feature_id,
        f.label as title,
        (
          SELECT COUNT(*)::text FROM graph_nodes us
          JOIN graph_edges ge ON ge.to_node_id = us.id AND ge.kind='REFINES'
          WHERE ge.from_node_id = f.id AND us.kind='USER_STORY'
        ) as story_count,
        (
          SELECT COUNT(*)::text FROM graph_nodes n
          JOIN graph_edges ge ON ge.to_node_id = n.id AND ge.kind IN ('DEFINES','RELATES_TO')
          WHERE ge.from_node_id = f.id
            AND n.kind IN ('DOMAIN_CONCEPT','KPI','REGULATION','BUSINESS_RULE')
        ) as concept_count,
        (
          SELECT COUNT(*)::text FROM graph_nodes bc
          JOIN graph_edges ge ON ge.from_node_id = bc.id AND ge.kind='IMPLEMENTS'
          WHERE ge.to_node_id = f.id AND bc.kind='BOUNDED_CONTEXT'
        ) as context_count,
        (
          SELECT COUNT(*)::text FROM graph_nodes n
          JOIN graph_edges ge ON ge.from_node_id = n.id AND ge.kind='IMPLEMENTS'
          WHERE ge.to_node_id = f.id AND n.kind='IMPLEMENTATION_NOTE'
        ) as note_count,
        (
          SELECT COUNT(*)::text FROM graph_nodes n
          JOIN graph_edges ge ON ge.from_node_id = n.id AND ge.kind='VERIFIES'
          WHERE ge.to_node_id = f.id AND n.kind='TEST_SUITE'
        ) as run_count,
        (
          SELECT COUNT(*)::text FROM graph_edges ge
          JOIN graph_nodes n ON n.id = ge.from_node_id
          WHERE ge.to_node_id = f.id AND ge.kind='BLOCKS'
            AND n.kind IN ('TEST_CASE','TEST_RUN')
        ) as blocked_count,
        (
          SELECT COUNT(*)::text FROM graph_nodes n
          JOIN graph_edges ge ON ge.from_node_id = n.id AND ge.kind='DOCUMENTS'
          WHERE ge.to_node_id = f.id AND n.kind='DOCUMENTATION'
        ) as docs_count
      FROM graph_nodes f
      WHERE f.kind='FEATURE'
        AND COALESCE(f.metadata->>'status','') <> 'merged'
        AND EXISTS (
          SELECT 1 FROM graph_nodes dr
          WHERE dr.kind='DECISION_RECORD'
            AND dr.metadata->>'gate'='PORTFOLIO_GATE'
            AND COALESCE((dr.metadata->>'demoRetired')::boolean, false) = false
            AND LOWER(dr.metadata->>'decision') = 'admit'
            AND (
              (dr.description::jsonb->>'featureId')::int = f.id
              OR (dr.metadata->>'cycleId') IN (SELECT id::text FROM cycles WHERE feature_id = f.id)
              OR EXISTS (
                SELECT 1 FROM graph_edges ge
                WHERE ge.from_node_id = dr.id AND ge.to_node_id = f.id AND ge.kind='APPROVES'
              )
            )
        )
      ORDER BY f.created_at DESC
    `)
  }

  app.get('/studio/domain', async () => {
    const rows = await admittedFeaturesWithCounts()
    return rows.map((r) => {
      const concepts = Number(r.concept_count ?? 0)
      const stories = Number(r.story_count ?? 0)
      return {
        feature_id: r.feature_id,
        title: r.title,
        story_count: stories,
        item_count: concepts,
        status: concepts > 0 ? 'Domain modeled' : 'Needs domain model',
      }
    })
  })

  app.get<{ Params: { id: string } }>('/studio/domain/:id', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    if (!Number.isFinite(featureId)) return reply.status(400).send({ error: 'invalid id' })

    const feature = await queryOne<{ id: number; label: string; description: string | null }>(
      `SELECT id, label, description FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })

    const admitted = await isFeatureAdmitted(featureId)
    if (!admitted) {
      return {
        feature_id: feature.id,
        title: feature.label,
        admitted: false,
        has_stories: false,
        status: 'Not admitted',
        concepts: [],
        kpis: [],
        regulations: [],
        rules: [],
      }
    }

    const storyCount = await queryOne<{ n: string }>(
      `SELECT COUNT(*)::text as n FROM graph_nodes us
       JOIN graph_edges ge ON ge.to_node_id = us.id AND ge.kind='REFINES'
       WHERE ge.from_node_id = $1 AND us.kind='USER_STORY'`,
      [featureId],
    )
    const hasStories = Number(storyCount?.n ?? 0) > 0

    const loadKind = async (kind: string, edgeKind: 'DEFINES' | 'RELATES_TO') =>
      query<{ id: number; label: string; description: string | null; metadata: Record<string, unknown> }>(
        `SELECT n.id, n.label, n.description, n.metadata
         FROM graph_nodes n
         JOIN graph_edges ge ON ge.to_node_id = n.id AND ge.kind=$3
         WHERE ge.from_node_id = $1 AND n.kind=$2
         ORDER BY n.created_at`,
        [featureId, kind, edgeKind],
      )

    const [concepts, kpis, regulations, rules] = await Promise.all([
      loadKind('DOMAIN_CONCEPT', 'DEFINES'),
      loadKind('KPI', 'DEFINES'),
      loadKind('REGULATION', 'RELATES_TO'),
      loadKind('BUSINESS_RULE', 'DEFINES'),
    ])

    const mapItem = (n: {
      id: number
      label: string
      description: string | null
      metadata: Record<string, unknown>
    }) => ({
      id: n.id,
      name: n.label,
      description: n.description ?? '',
      target: typeof n.metadata?.target === 'string' ? n.metadata.target : undefined,
    })

    const itemCount = concepts.length + kpis.length + regulations.length + rules.length

    return {
      feature_id: feature.id,
      title: feature.label,
      description: feature.description,
      admitted: true,
      has_stories: hasStories,
      status: itemCount > 0 ? 'Domain modeled' : 'Needs domain model',
      concepts: concepts.map(mapItem),
      kpis: kpis.map(mapItem),
      regulations: regulations.map(mapItem),
      rules: rules.map(mapItem),
    }
  })

  app.post<{ Params: { id: string } }>('/studio/domain/:id/draft', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })

    if (!(await isFeatureAdmitted(featureId))) {
      return reply.status(400).send({ error: 'Case must be admitted before drafting the domain model' })
    }

    const cycle = await queryOne<{ id: string }>(
      `SELECT id FROM cycles WHERE feature_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [featureId],
    )

    const adapter = await createHttpAdapter(opts.platformUrl, DOMAIN_STEWARD_MANIFEST)
    const agent = new DomainStewardAgent(adapter, opts.llm)
    return agent.run({ featureId, cycleId: cycle?.id })
  })

  app.get('/studio/architecture', async () => {
    const rows = await admittedFeaturesWithCounts()
    return rows.map((r) => {
      const contexts = Number(r.context_count ?? 0)
      const stories = Number(r.story_count ?? 0)
      return {
        feature_id: r.feature_id,
        title: r.title,
        story_count: stories,
        context_count: contexts,
        status: contexts > 0 ? 'Architecture proposed' : 'Needs architecture',
      }
    })
  })

  app.get<{ Params: { id: string } }>('/studio/architecture/:id', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    if (!Number.isFinite(featureId)) return reply.status(400).send({ error: 'invalid id' })

    const feature = await queryOne<{ id: number; label: string; description: string | null }>(
      `SELECT id, label, description FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })

    const admitted = await isFeatureAdmitted(featureId)
    if (!admitted) {
      return {
        feature_id: feature.id,
        title: feature.label,
        admitted: false,
        has_stories: false,
        status: 'Not admitted',
        contexts: [],
        interfaces: [],
      }
    }

    const stories = await query<{ id: number }>(
      `SELECT us.id FROM graph_nodes us
       JOIN graph_edges ge ON ge.to_node_id = us.id AND ge.kind='REFINES'
       WHERE ge.from_node_id = $1 AND us.kind='USER_STORY'`,
      [featureId],
    )
    const hasStories = stories.length > 0

    const contexts = await query<{
      id: number
      label: string
      description: string | null
    }>(
      `SELECT bc.id, bc.label, bc.description
       FROM graph_nodes bc
       JOIN graph_edges ge ON ge.from_node_id = bc.id AND ge.kind='IMPLEMENTS'
       WHERE ge.to_node_id = $1 AND bc.kind='BOUNDED_CONTEXT'
       ORDER BY bc.created_at`,
      [featureId],
    )

    const contextIds = contexts.map((c) => c.id)
    const interfaces =
      contextIds.length === 0
        ? []
        : await query<{
            id: number
            label: string
            description: string | null
            metadata: Record<string, unknown>
            context_id: number
          }>(
            `SELECT si.id, si.label, si.description, si.metadata, ge.to_node_id as context_id
             FROM graph_nodes si
             JOIN graph_edges ge ON ge.from_node_id = si.id AND ge.kind='IMPLEMENTS'
             WHERE si.kind='SERVICE_INTERFACE' AND ge.to_node_id = ANY($1::int[])
             ORDER BY si.created_at`,
            [contextIds],
          )

    const depends = contextIds.length
      ? await query<{ from_node_id: number; to_node_id: number }>(
          `SELECT from_node_id, to_node_id FROM graph_edges
           WHERE kind='DEPENDS_ON' AND from_node_id = ANY($1::int[]) AND to_node_id = ANY($1::int[])`,
          [contextIds],
        )
      : []

    const labelById = new Map(contexts.map((c) => [c.id, c.label]))

    return {
      feature_id: feature.id,
      title: feature.label,
      description: feature.description,
      admitted: true,
      has_stories: hasStories,
      status: contexts.length > 0 ? 'Architecture proposed' : 'Needs architecture',
      contexts: contexts.map((c) => ({
        id: c.id,
        name: c.label,
        description: c.description ?? '',
        depends_on: depends
          .filter((d) => d.from_node_id === c.id)
          .map((d) => labelById.get(d.to_node_id) ?? String(d.to_node_id)),
      })),
      interfaces: interfaces.map((i) => ({
        id: i.id,
        name: i.label,
        description: i.description ?? '',
        protocol: typeof i.metadata?.protocol === 'string' ? i.metadata.protocol : 'HTTP',
        context:
          typeof i.metadata?.context === 'string'
            ? i.metadata.context
            : (labelById.get(i.context_id) ?? ''),
      })),
    }
  })

  app.post<{ Params: { id: string } }>('/studio/architecture/:id/draft', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })

    if (!(await isFeatureAdmitted(featureId))) {
      return reply.status(400).send({ error: 'Case must be admitted before proposing architecture' })
    }

    const stories = await query<{ id: number }>(
      `SELECT us.id FROM graph_nodes us
       JOIN graph_edges ge ON ge.to_node_id = us.id AND ge.kind='REFINES'
       WHERE ge.from_node_id = $1 AND us.kind='USER_STORY'
       ORDER BY us.created_at`,
      [featureId],
    )
    if (!stories.length) {
      return reply.status(400).send({ error: 'Draft requirements before proposing architecture' })
    }

    const cycle = await queryOne<{ id: string }>(
      `SELECT id FROM cycles WHERE feature_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [featureId],
    )

    const adapter = await createHttpAdapter(opts.platformUrl, SOLUTIONS_ARCHITECT_MANIFEST)
    const agent = new SolutionsArchitectAgent(adapter, opts.llm)
    return agent.run({
      featureId,
      storyIds: stories.map((s) => s.id),
      cycleId: cycle?.id,
    })
  })

  // ── Build: Implementation / Quality / Docs ────────────────────────────────

  async function featureHasArchitecture(featureId: number): Promise<boolean> {
    const row = await queryOne<{ n: string }>(
      `SELECT COUNT(*)::text as n FROM graph_nodes bc
       JOIN graph_edges ge ON ge.from_node_id = bc.id AND ge.kind='IMPLEMENTS'
       WHERE ge.to_node_id = $1 AND bc.kind='BOUNDED_CONTEXT'`,
      [featureId],
    )
    return Number(row?.n ?? 0) > 0
  }

  async function featureHasImplementation(featureId: number): Promise<boolean> {
    const row = await queryOne<{ n: string }>(
      `SELECT COUNT(*)::text as n FROM graph_nodes n
       JOIN graph_edges ge ON ge.from_node_id = n.id AND ge.kind='IMPLEMENTS'
       WHERE ge.to_node_id = $1 AND n.kind='IMPLEMENTATION_NOTE'`,
      [featureId],
    )
    return Number(row?.n ?? 0) > 0
  }

  app.get('/studio/build', async () => {
    const rows = await admittedFeaturesWithCounts()
    return rows.map((r) => {
      const notes = Number(r.note_count ?? 0)
      return {
        feature_id: r.feature_id,
        title: r.title,
        context_count: Number(r.context_count ?? 0),
        note_count: notes,
        status: notes > 0 ? 'Implementation recorded' : 'Needs implementation',
      }
    })
  })

  app.get<{ Params: { id: string } }>('/studio/build/:id', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    if (!Number.isFinite(featureId)) return reply.status(400).send({ error: 'invalid id' })

    const feature = await queryOne<{ id: number; label: string; description: string | null }>(
      `SELECT id, label, description FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })

    const admitted = await isFeatureAdmitted(featureId)
    if (!admitted) {
      return {
        feature_id: feature.id,
        title: feature.label,
        admitted: false,
        has_architecture: false,
        status: 'Not admitted',
        notes: [],
        files: [],
      }
    }

    const hasArchitecture = await featureHasArchitecture(featureId)

    const notes = await query<{
      id: number
      label: string
      description: string | null
      metadata: Record<string, unknown>
    }>(
      `SELECT n.id, n.label, n.description, n.metadata
       FROM graph_nodes n
       JOIN graph_edges ge ON ge.from_node_id = n.id AND ge.kind='IMPLEMENTS'
       WHERE ge.to_node_id = $1 AND n.kind='IMPLEMENTATION_NOTE'
       ORDER BY n.created_at DESC`,
      [featureId],
    )

    const files = await query<{
      id: number
      label: string
      description: string | null
      metadata: Record<string, unknown>
    }>(
      `SELECT n.id, n.label, n.description, n.metadata
       FROM graph_nodes n
       JOIN graph_edges ge ON ge.from_node_id = n.id AND ge.kind='IMPLEMENTS'
       WHERE ge.to_node_id = $1 AND n.kind='CODE_FILE'
       ORDER BY n.created_at`,
      [featureId],
    )

    return {
      feature_id: feature.id,
      title: feature.label,
      description: feature.description,
      admitted: true,
      has_architecture: hasArchitecture,
      status: notes.length > 0 ? 'Implementation recorded' : 'Needs implementation',
      notes: notes.map((n) => ({
        id: n.id,
        title: n.label,
        description: n.description ?? '',
        risk: typeof n.metadata?.risk === 'string' ? n.metadata.risk : 'low',
        files: Array.isArray(n.metadata?.files)
          ? (n.metadata.files as unknown[]).map(String)
          : [],
      })),
      files: files.map((f) => ({
        id: f.id,
        path: typeof f.metadata?.path === 'string' ? f.metadata.path : f.label,
        label: f.label,
      })),
    }
  })

  app.post<{ Params: { id: string } }>('/studio/build/:id/record', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })

    if (!(await isFeatureAdmitted(featureId))) {
      return reply.status(400).send({ error: 'Case must be admitted before recording implementation' })
    }
    if (!(await featureHasArchitecture(featureId))) {
      return reply.status(400).send({ error: 'Propose architecture before recording implementation' })
    }

    const cycle = await queryOne<{ id: string }>(
      `SELECT id FROM cycles WHERE feature_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [featureId],
    )

    const body = (req.body ?? {}) as { files?: string[]; note?: string }
    const tollOs = /toll\.os|mlff/i.test(feature.label)
    const defaultFiles = tollOs
      ? [
          'packages/tollos/fusion/anprRfid.ts',
          'packages/tollos/exceptions/lidarWorkflow.ts',
          'packages/tollos/metering/eventLedger.ts',
          'packages/tollos/metering/eventLedger.test.ts',
        ]
      : undefined
    const defaultNote = tollOs
      ? 'Record ANPR/RFID fusion, LiDAR exception orchestration, and idempotent ₹5 Toll.OS event metering.'
      : undefined
    const adapter = await createHttpAdapter(opts.platformUrl, SOFTWARE_ENGINEERING_MANIFEST)
    const agent = new SoftwareEngineeringAgent(adapter, opts.llm)
    return agent.run({
      featureId,
      cycleId: cycle?.id,
      files: body.files?.length ? body.files : defaultFiles,
      note: body.note ?? defaultNote,
    })
  })

  app.get('/studio/quality', async () => {
    const rows = await admittedFeaturesWithCounts()
    return rows.map((r) => {
      const suites = Number(r.run_count ?? 0)
      const blocked = Number(r.blocked_count ?? 0)
      let status: 'Needs quality check' | 'Quality passed' | 'Quality blocked' =
        'Needs quality check'
      if (suites > 0) status = blocked > 0 ? 'Quality blocked' : 'Quality passed'
      return {
        feature_id: r.feature_id,
        title: r.title,
        note_count: Number(r.note_count ?? 0),
        suite_count: suites,
        status,
      }
    })
  })

  app.get<{ Params: { id: string } }>('/studio/quality/:id', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    if (!Number.isFinite(featureId)) return reply.status(400).send({ error: 'invalid id' })

    const feature = await queryOne<{ id: number; label: string; description: string | null }>(
      `SELECT id, label, description FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })

    const admitted = await isFeatureAdmitted(featureId)
    if (!admitted) {
      return {
        feature_id: feature.id,
        title: feature.label,
        admitted: false,
        has_implementation: false,
        status: 'Not admitted',
        suites: [],
        runs: [],
        cases: [],
      }
    }

    const hasImplementation = await featureHasImplementation(featureId)

    const suites = await query<{
      id: number
      label: string
      description: string | null
    }>(
      `SELECT n.id, n.label, n.description
       FROM graph_nodes n
       JOIN graph_edges ge ON ge.from_node_id = n.id AND ge.kind='VERIFIES'
       WHERE ge.to_node_id = $1 AND n.kind='TEST_SUITE'
       ORDER BY n.created_at DESC`,
      [featureId],
    )

    const suiteIds = suites.map((s) => s.id)
    const cases =
      suiteIds.length === 0
        ? []
        : await query<{
            id: number
            label: string
            description: string | null
            metadata: Record<string, unknown>
            suite_id: number
          }>(
            `SELECT n.id, n.label, n.description, n.metadata, ge.to_node_id as suite_id
             FROM graph_nodes n
             JOIN graph_edges ge ON ge.from_node_id = n.id AND ge.kind='VERIFIES'
             WHERE n.kind='TEST_CASE' AND ge.to_node_id = ANY($1::int[])
             ORDER BY n.created_at`,
            [suiteIds],
          )

    const runs =
      suiteIds.length === 0
        ? []
        : await query<{
            id: number
            label: string
            description: string | null
            metadata: Record<string, unknown>
            suite_id: number
          }>(
            `SELECT n.id, n.label, n.description, n.metadata, ge.to_node_id as suite_id
             FROM graph_nodes n
             JOIN graph_edges ge ON ge.from_node_id = n.id AND ge.kind='VERIFIES'
             WHERE n.kind='TEST_RUN' AND ge.to_node_id = ANY($1::int[])
             ORDER BY n.created_at DESC`,
            [suiteIds],
          )

    const blocked = await queryOne<{ n: string }>(
      `SELECT COUNT(*)::text as n FROM graph_edges ge
       JOIN graph_nodes n ON n.id = ge.from_node_id
       WHERE ge.to_node_id = $1 AND ge.kind='BLOCKS'
         AND n.kind IN ('TEST_CASE','TEST_RUN')`,
      [featureId],
    )
    const isBlocked = Number(blocked?.n ?? 0) > 0
    let status: string = 'Needs quality check'
    if (suites.length > 0) status = isBlocked ? 'Quality blocked' : 'Quality passed'

    return {
      feature_id: feature.id,
      title: feature.label,
      description: feature.description,
      admitted: true,
      has_implementation: hasImplementation,
      status,
      blocked: isBlocked,
      suites: suites.map((s) => ({
        id: s.id,
        title: s.label,
        summary: s.description ?? '',
      })),
      runs: runs.map((r) => ({
        id: r.id,
        title: r.label,
        conclusion:
          typeof r.metadata?.conclusion === 'string' ? r.metadata.conclusion : 'unknown',
        passed: typeof r.metadata?.passed === 'number' ? r.metadata.passed : 0,
        failed: typeof r.metadata?.failed === 'number' ? r.metadata.failed : 0,
        summary: safeJsonSummary(r.description),
      })),
      cases: cases.map((c) => ({
        id: c.id,
        name: c.label,
        status: typeof c.metadata?.status === 'string' ? c.metadata.status : 'unknown',
        severity: typeof c.metadata?.severity === 'string' ? c.metadata.severity : 'info',
        suite_id: c.suite_id,
      })),
    }
  })

  app.post<{ Params: { id: string } }>('/studio/quality/:id/run', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })

    if (!(await isFeatureAdmitted(featureId))) {
      return reply.status(400).send({ error: 'Case must be admitted before running quality checks' })
    }
    if (!(await featureHasImplementation(featureId))) {
      return reply.status(400).send({ error: 'Record implementation before running quality checks' })
    }

    const cycle = await queryOne<{ id: string }>(
      `SELECT id FROM cycles WHERE feature_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [featureId],
    )

    const body = (req.body ?? {}) as {
      fixtureResults?: Array<{ name: string; status: string; severity?: string }>
    }
    const tollOs = /toll\.os|mlff/i.test(feature.label)
    const defaultFixtures = tollOs
      ? [
          { name: 'meter-anpr-inr-event', status: 'passed' },
          { name: 'fuse-rfid-anpr-single-event', status: 'passed' },
          { name: 'lidar-exception-resolves-to-meter', status: 'passed' },
          { name: 'idempotent-replay-no-double-bill', status: 'passed' },
        ]
      : undefined
    const adapter = await createHttpAdapter(opts.platformUrl, QUALITY_ENGINEERING_MANIFEST)
    const agent = new QualityEngineeringAgent(adapter, opts.llm)
    return agent.run({
      featureId,
      cycleId: cycle?.id,
      fixtureResults: body.fixtureResults?.length ? body.fixtureResults : defaultFixtures,
    })
  })

  app.get('/studio/docs', async () => {
    const rows = await admittedFeaturesWithCounts()
    return rows.map((r) => {
      const docs = Number(r.docs_count ?? 0)
      return {
        feature_id: r.feature_id,
        title: r.title,
        note_count: Number(r.note_count ?? 0),
        docs_count: docs,
        status: docs > 0 ? 'Docs drafted' : 'Needs docs',
      }
    })
  })

  app.get<{ Params: { id: string } }>('/studio/docs/:id', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    if (!Number.isFinite(featureId)) return reply.status(400).send({ error: 'invalid id' })

    const feature = await queryOne<{ id: number; label: string; description: string | null }>(
      `SELECT id, label, description FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })

    const admitted = await isFeatureAdmitted(featureId)
    if (!admitted) {
      return {
        feature_id: feature.id,
        title: feature.label,
        admitted: false,
        has_implementation: false,
        status: 'Not admitted',
        documentation: null,
        changelog: null,
      }
    }

    const hasImplementation = await featureHasImplementation(featureId)

    const documentation = await queryOne<{
      id: number
      label: string
      description: string | null
    }>(
      `SELECT n.id, n.label, n.description
       FROM graph_nodes n
       JOIN graph_edges ge ON ge.from_node_id = n.id AND ge.kind='DOCUMENTS'
       WHERE ge.to_node_id = $1 AND n.kind='DOCUMENTATION'
       ORDER BY n.created_at DESC LIMIT 1`,
      [featureId],
    )

    const changelog = await queryOne<{
      id: number
      label: string
      description: string | null
    }>(
      `SELECT n.id, n.label, n.description
       FROM graph_nodes n
       JOIN graph_edges ge ON ge.from_node_id = n.id AND ge.kind='DOCUMENTS'
       WHERE ge.to_node_id = $1 AND n.kind='CHANGELOG'
       ORDER BY n.created_at DESC LIMIT 1`,
      [featureId],
    )

    return {
      feature_id: feature.id,
      title: feature.label,
      description: feature.description,
      admitted: true,
      has_implementation: hasImplementation,
      status: documentation ? 'Docs drafted' : 'Needs docs',
      documentation: documentation
        ? {
            id: documentation.id,
            title: documentation.label,
            outline: documentation.description ?? '',
          }
        : null,
      changelog: changelog
        ? {
            id: changelog.id,
            title: changelog.label,
            body: changelog.description ?? '',
          }
        : null,
    }
  })

  app.post<{ Params: { id: string } }>('/studio/docs/:id/draft', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })

    if (!(await isFeatureAdmitted(featureId))) {
      return reply.status(400).send({ error: 'Case must be admitted before drafting docs' })
    }
    if (!(await featureHasImplementation(featureId))) {
      return reply.status(400).send({ error: 'Record implementation before drafting docs' })
    }

    const cycle = await queryOne<{ id: string }>(
      `SELECT id FROM cycles WHERE feature_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [featureId],
    )

    const adapter = await createHttpAdapter(opts.platformUrl, DOCUMENTATION_MANIFEST)
    const agent = new DocumentationAgent(adapter, opts.llm)
    return agent.run({ featureId, cycleId: cycle?.id })
  })

  await registerShipLearnRoutes(app, opts)
}

function safeJsonSummary(description: string | null): string {
  if (!description) return ''
  try {
    const parsed = JSON.parse(description) as { summary?: string }
    return parsed.summary ?? description
  } catch {
    return description
  }
}

