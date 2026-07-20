import { v4 as uuid } from 'uuid'
import { query, queryOne } from '../db/pool.js'
import type { ContextBus } from '../bus/contextBus.js'
import type { VerbDomain } from '@avp/shared'

type StageKind = 'AUTO' | 'WAIT' | 'GATE' | 'TERMINAL'

interface StageDefinition {
  id: string
  kind: StageKind
  domain: VerbDomain
  title: string
  predicate: (ctx: StageContext) => Promise<boolean>
  next?: string
  onBounce?: string
}

interface StageContext {
  cycleId: string
  featureId?: number
  featureLabel?: string
  metadata: Record<string, unknown>
  read: <T>(sql: string, params?: unknown[]) => Promise<T[]>
}

const STAGES: StageDefinition[] = [
  {
    id: 'SIGNALS',
    kind: 'WAIT',
    domain: 'listen',
    title: 'Hear from customers',
    predicate: async (ctx) => {
      const [r] = await ctx.read<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM graph_nodes WHERE kind='CUSTOMER_SIGNAL'`,
      )
      return parseInt(r?.count ?? '0', 10) >= 5
    },
    next: 'CLUSTER',
  },
  {
    id: 'CLUSTER',
    kind: 'AUTO',
    domain: 'listen',
    title: 'Find the patterns',
    predicate: async (ctx) => {
      const [r] = await ctx.read<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM graph_nodes WHERE kind='PAIN_POINT'`,
      )
      return parseInt(r?.count ?? '0', 10) >= 1
    },
    next: 'INTAKE',
  },
  {
    id: 'INTAKE',
    kind: 'AUTO',
    domain: 'decide',
    title: 'Write the case for action',
    predicate: async (ctx) => {
      const [r] = await ctx.read<{ id: number }>(
        `SELECT id FROM graph_nodes WHERE kind='BRIEF' LIMIT 1`,
      )
      return !!r
    },
    next: 'QUALIFY',
  },
  {
    id: 'QUALIFY',
    kind: 'AUTO',
    domain: 'decide',
    title: 'Size the opportunity',
    predicate: async (ctx) => {
      const [biz] = await ctx.read<{ id: number }>(
        `SELECT id FROM graph_nodes WHERE kind='BUSINESS_IMPACT' LIMIT 1`,
      )
      const [eng] = await ctx.read<{ id: number }>(
        `SELECT id FROM graph_nodes WHERE kind='DEV_IMPACT' LIMIT 1`,
      )
      return !!biz && !!eng
    },
    next: 'PACKET',
  },
  {
    id: 'PACKET',
    kind: 'AUTO',
    domain: 'decide',
    title: 'Prepare the decision packet',
    predicate: async (ctx) => {
      const [r] = await ctx.read<{ id: number }>(
        `SELECT id FROM graph_nodes WHERE kind='PORTFOLIO_PACKET' LIMIT 1`,
      )
      return !!r
    },
    next: 'PORTFOLIO_GATE',
  },
  {
    id: 'PORTFOLIO_GATE',
    kind: 'GATE',
    domain: 'decide',
    title: 'Leadership decides',
    predicate: async (ctx) => {
      const [r] = await ctx.read<{ metadata: Record<string, unknown> }>(
        `SELECT metadata FROM graph_nodes
         WHERE kind='DECISION_RECORD'
           AND (metadata->>'gate')='PORTFOLIO_GATE'
           AND (metadata->>'decision')='admit'
         LIMIT 1`,
      )
      return !!r
    },
    next: 'BUILD',
    onBounce: 'SIGNALS',
  },
  {
    id: 'BUILD',
    kind: 'WAIT',
    domain: 'build',
    title: 'Design and build it',
    predicate: async (ctx) => {
      const [r] = await ctx.read<{ id: number }>(
        `SELECT id FROM graph_nodes
         WHERE kind='BUILD' AND (metadata->>'conclusion')='success'
         LIMIT 1`,
      )
      return !!r
    },
    next: 'CONSOLIDATE',
  },
  {
    id: 'CONSOLIDATE',
    kind: 'AUTO',
    domain: 'ship',
    title: 'Check if it is safe to ship',
    predicate: async (ctx) => {
      const [r] = await ctx.read<{ metadata: Record<string, unknown> }>(
        `SELECT metadata FROM graph_nodes
         WHERE kind='READINESS_REPORT'
         ORDER BY created_at DESC LIMIT 1`,
      )
      return !!(r?.metadata as { ready?: boolean } | undefined)?.ready
    },
    next: 'RELEASE_GATE',
    onBounce: 'BUILD',
  },
  {
    id: 'RELEASE_GATE',
    kind: 'GATE',
    domain: 'ship',
    title: 'Required approvers sign off',
    predicate: async (ctx) => {
      const [report] = await ctx.read<{ description: string; metadata: Record<string, unknown> }>(
        `SELECT description, metadata FROM graph_nodes
         WHERE kind='READINESS_REPORT'
         ORDER BY created_at DESC LIMIT 1`,
      )
      if (!report) return false
      let required: string[] = []
      try {
        const fromDesc = JSON.parse(report.description) as { approvalSet?: string[] }
        required = fromDesc.approvalSet ?? []
      } catch {
        required = (report.metadata?.approvalSet as string[] | undefined) ?? []
      }
      if (required.length === 0) return true
      const signed = await ctx.read<{ metadata: Record<string, unknown> }>(
        `SELECT metadata FROM graph_nodes
         WHERE kind='DECISION_RECORD' AND (metadata->>'gate')='RELEASE_GATE'`,
      )
      const signedRoles = signed.map((s) => s.metadata?.role)
      return required.every((role) => signedRoles.includes(role))
    },
    next: 'ROLLOUT',
  },
  {
    id: 'ROLLOUT',
    kind: 'AUTO',
    domain: 'ship',
    title: 'Release to customers gradually',
    predicate: async (ctx) => {
      const [r] = await ctx.read<{ id: number }>(
        `SELECT id FROM graph_nodes
         WHERE kind='DEPLOYMENT' AND (metadata->>'status')='deployed'
         LIMIT 1`,
      )
      return !!r
    },
    next: 'OBSERVE',
  },
  {
    id: 'OBSERVE',
    kind: 'WAIT',
    domain: 'ship',
    title: 'Watch the metrics move',
    predicate: async (ctx) => {
      const [hyps] = await ctx.read<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM graph_nodes
         WHERE kind='VALUE_HYPOTHESIS' AND (metadata->>'committed')='true'`,
      )
      const hypCount = parseInt(hyps?.count ?? '0', 10)
      if (hypCount === 0) return true
      const [obs] = await ctx.read<{ count: string }>(
        `SELECT COUNT(DISTINCT (metadata->>'kpiLabel'))::text as count
         FROM graph_nodes WHERE kind='KPI_OBSERVATION'`,
      )
      const obsCount = parseInt(obs?.count ?? '0', 10)
      const [total] = await ctx.read<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM graph_nodes WHERE kind='KPI_OBSERVATION'`,
      )
      return obsCount >= hypCount && parseInt(total?.count ?? '0', 10) >= 2
    },
    next: 'LEARN',
  },
  {
    id: 'LEARN',
    kind: 'AUTO',
    domain: 'learn',
    title: 'Judge the bets, capture lessons',
    predicate: async (ctx) => {
      const [r] = await ctx.read<{ id: number }>(
        `SELECT id FROM graph_nodes WHERE kind='OUTCOME' LIMIT 1`,
      )
      return !!r
    },
    next: 'DONE',
  },
  {
    id: 'DONE',
    kind: 'TERMINAL',
    domain: 'learn',
    title: 'Cycle complete — loop back smarter',
    predicate: async () => false,
  },
]

const STAGE_MAP = new Map(STAGES.map((s) => [s.id, s]))

function normalizeStage(stage: string): string {
  if (stage === 'LISTEN') return 'SIGNALS'
  return stage
}

export class CycleOrchestrator {
  private locks = new Set<string>()

  constructor(private readonly bus: ContextBus) {}

  async advance(cycleId: string): Promise<void> {
    if (this.locks.has(cycleId)) return
    this.locks.add(cycleId)
    try {
      await this._advance(cycleId)
    } finally {
      this.locks.delete(cycleId)
    }
  }

  private async _advance(cycleId: string): Promise<void> {
    const cycle = await queryOne<{
      id: string
      current_stage: string
      feature_id: number | null
      metadata: Record<string, unknown> | null
    }>(`SELECT id, current_stage, feature_id, metadata FROM cycles WHERE id=$1`, [cycleId])
    if (!cycle) return

    const currentStage = normalizeStage(cycle.current_stage)
    if (currentStage === 'DONE') return

    if (currentStage !== cycle.current_stage) {
      await query(`UPDATE cycles SET current_stage=$1, updated_at=NOW() WHERE id=$2`, [
        currentStage,
        cycleId,
      ])
    }

    const stage = STAGE_MAP.get(currentStage)
    if (!stage) return

    const ctx: StageContext = {
      cycleId,
      featureId: cycle.feature_id ?? undefined,
      metadata: cycle.metadata ?? {},
      read: (sql, params) => query(sql, params),
    }

    const canAdvance = await stage.predicate(ctx)
    if (!canAdvance) return

    const nextStageId = stage.next
    if (!nextStageId) return

    await query(`UPDATE cycles SET current_stage=$1, updated_at=NOW() WHERE id=$2`, [
      nextStageId,
      cycleId,
    ])
    this.log(cycleId, currentStage, nextStageId)

    await this.bus.publish({
      id: uuid(),
      traceId: uuid(),
      spanId: uuid(),
      agentId: 'cycle-orchestrator',
      runtime: 'studio',
      domain: stage.domain,
      kind: 'stage_advanced',
      graphDelta: { nodesCreated: [], edgesCreated: [] },
      cycleId,
      featureId: cycle.feature_id ?? undefined,
      ts: Date.now(),
      metadata: { fromStage: currentStage, toStage: nextStageId },
    })

    const nextStage = STAGE_MAP.get(nextStageId)
    if (nextStage?.kind === 'AUTO') {
      await new Promise((r) => setTimeout(r, 500))
      await this._advance(cycleId)
    }
  }

  async recordGate(
    cycleId: string,
    gate: string,
    decision: string,
    role: string,
    rationale: string,
  ): Promise<number> {
    const featureId = (
      await queryOne<{ feature_id: number | null }>(`SELECT feature_id FROM cycles WHERE id=$1`, [
        cycleId,
      ])
    )?.feature_id

    const result = await query<{ id: number }>(
      `
      INSERT INTO graph_nodes (kind, label, description, metadata, written_by_agent, trace_id)
      VALUES ('DECISION_RECORD', $1, $2, $3, 'human-gate', $4)
      RETURNING id
    `,
      [
        `${gate}: ${decision} by ${role}`,
        JSON.stringify({ cycleId, gate, decision, role, rationale, ts: Date.now(), featureId }),
        JSON.stringify({ gate, decision, role, cycleId }),
        uuid(),
      ],
    )
    const nodeId = result[0]!.id

    if (decision === 'defer' && gate === 'PORTFOLIO_GATE') {
      await query(`UPDATE cycles SET current_stage='SIGNALS', updated_at=NOW() WHERE id=$1`, [
        cycleId,
      ])
    } else if (decision === 'reject' && gate === 'PORTFOLIO_GATE') {
      await query(
        `UPDATE cycles SET status='rejected', current_stage='DONE',
           metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
           updated_at=NOW()
         WHERE id=$1`,
        [cycleId, JSON.stringify({ gateDecision: 'reject', rationale })],
      )
    } else {
      await this.advance(cycleId)
    }
    return nodeId
  }

  async commitHypotheses(cycleId: string): Promise<void> {
    await query(
      `
      UPDATE graph_nodes SET metadata = metadata || '{"committed":true}'::jsonb
      WHERE kind='VALUE_HYPOTHESIS'
        AND (metadata->>'committed') IS DISTINCT FROM 'true'
        AND (metadata->>'cycleId')=$1
    `,
      [cycleId],
    )
  }

  private log(cycleId: string, fromStage: string, toStage: string): void {
    console.log(`[Orchestrator] Cycle ${cycleId}: ${fromStage} → ${toStage}`)
  }

  async tick(): Promise<void> {
    const active = await query<{ id: string }>(
      `SELECT id FROM cycles WHERE status='active' AND current_stage != 'DONE'`,
    )
    for (const cycle of active) {
      await this.advance(cycle.id).catch(console.error)
    }
  }
}
