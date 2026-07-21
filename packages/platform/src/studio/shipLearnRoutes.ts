import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { createHttpAdapter } from '@avp/shared/adapters/httpAdapter.js'
import type { ILLMGateway } from '@avp/shared'
import { DEVOPS_MANIFEST, DevOpsAgent } from '@avp/agents-ship-devops'
import { DEVSECOPS_MANIFEST, DevSecOpsAgent } from '@avp/agents-ship-devsecops'
import { FINOPS_MANIFEST, FinOpsAgent } from '@avp/agents-ship-finops'
import {
  RELEASE_MANAGER_MANIFEST,
  ReleaseManagerAgent,
} from '@avp/agents-ship-release-manager'
import {
  DEPLOYMENT_ENGINEER_MANIFEST,
  DeploymentEngineerAgent,
} from '@avp/agents-ship-deployment-engineer'
import { SRE_MANIFEST, SreAgent } from '@avp/agents-ship-sre'
import {
  ATTRIBUTION_ANALYST_MANIFEST,
  AttributionAnalystAgent,
} from '@avp/agents-learn-attribution-analyst'
import {
  STAKEHOLDER_IMPACT_MANIFEST,
  StakeholderImpactAgent,
} from '@avp/agents-learn-stakeholder-impact'
import {
  ORGANIZATIONAL_LEARNING_MANIFEST,
  OrganizationalLearningAgent,
} from '@avp/agents-learn-organizational-learning'
import {
  CALIBRATION_MANIFEST,
  CalibrationAgent,
} from '@avp/agents-learn-calibration'
import { query, queryOne } from '../db/pool.js'
import type { CycleOrchestrator } from '../orchestrator/cycleOrchestrator.js'

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

async function admittedFeatures() {
  return query<{ feature_id: number; title: string }>(`
    SELECT f.id as feature_id, f.label as title
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

async function cycleFor(featureId: number) {
  return queryOne<{ id: string; current_stage: string }>(
    `SELECT id, current_stage FROM cycles WHERE feature_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [featureId],
  )
}

async function featureHasQaPass(featureId: number): Promise<boolean> {
  const row = await queryOne<{ n: string }>(
    `SELECT COUNT(*)::text as n FROM graph_nodes b
     WHERE b.kind='BUILD'
       AND LOWER(COALESCE(b.metadata->>'conclusion',''))='success'
       AND (
         (b.metadata->>'featureId')::int = $1
         OR EXISTS (
           SELECT 1 FROM graph_edges ge
           WHERE ge.from_node_id = b.id AND ge.to_node_id = $1 AND ge.kind='VERIFIES'
         )
       )`,
    [featureId],
  )
  return Number(row?.n ?? 0) > 0
}

async function latestPipelineBuild(featureId: number) {
  return queryOne<{
    id: number
    label: string
    description: string | null
    metadata: Record<string, unknown>
  }>(
    `SELECT id, label, description, metadata FROM graph_nodes
     WHERE kind='BUILD'
       AND COALESCE(metadata->>'source','') <> 'quality-engineering'
       AND (metadata->>'featureId')::int = $1
     ORDER BY created_at DESC LIMIT 1`,
    [featureId],
  )
}

async function latestScan(featureId: number) {
  return queryOne<{
    id: number
    label: string
    description: string | null
    metadata: Record<string, unknown>
  }>(
    `SELECT id, label, description, metadata FROM graph_nodes
     WHERE kind='SECURITY_SCAN' AND (metadata->>'featureId')::int = $1
        OR (metadata->>'sha') IS NOT NULL AND EXISTS (
          SELECT 1 FROM graph_nodes b
          WHERE b.kind='BUILD' AND (b.metadata->>'featureId')::int = $1
            AND b.metadata->>'gitSha' = graph_nodes.metadata->>'sha'
        )
     ORDER BY created_at DESC LIMIT 1`,
    [featureId],
  )
}

export async function registerShipLearnRoutes(
  app: FastifyInstance,
  opts: { llm: ILLMGateway; platformUrl: string; orchestrator?: CycleOrchestrator },
): Promise<void> {
  // ── Ship: Builds ──────────────────────────────────────────────────────────

  app.get('/studio/builds', async () => {
    const features = await admittedFeatures()
    return Promise.all(
      features.map(async (f) => {
        const qa = await featureHasQaPass(f.feature_id)
        const build = await latestPipelineBuild(f.feature_id)
        const conclusion =
          typeof build?.metadata?.conclusion === 'string' ? build.metadata.conclusion : null
        let status = 'Needs pipeline build'
        if (!qa) status = 'Needs quality pass'
        else if (build) {
          status = /fail/i.test(conclusion ?? '') ? 'Build failed' : 'Build recorded'
        }
        return {
          feature_id: f.feature_id,
          title: f.title,
          has_qa: qa,
          build_id: build?.id ?? null,
          status,
        }
      }),
    )
  })

  app.get<{ Params: { id: string } }>('/studio/builds/:id', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })
    const admitted = await isFeatureAdmitted(featureId)
    const hasQa = await featureHasQaPass(featureId)
    const build = admitted ? await latestPipelineBuild(featureId) : null
    const iac = build
      ? await queryOne<{ id: number; label: string; description: string | null }>(
          `SELECT n.id, n.label, n.description FROM graph_nodes n
           JOIN graph_edges ge ON ge.to_node_id = n.id AND ge.kind='PRODUCED'
           WHERE ge.from_node_id = $1 AND n.kind='IAC_CHANGESET'
           ORDER BY n.created_at DESC LIMIT 1`,
          [build.id],
        )
      : null
    return {
      feature_id: feature.id,
      title: feature.label,
      admitted,
      has_qa: hasQa,
      status: !admitted
        ? 'Not admitted'
        : !hasQa
          ? 'Needs quality pass'
          : build
            ? 'Build recorded'
            : 'Needs pipeline build',
      build: build
        ? {
            id: build.id,
            title: build.label,
            conclusion: build.metadata?.conclusion ?? null,
            git_sha: build.metadata?.gitSha ?? null,
            run_id: build.metadata?.runId ?? null,
          }
        : null,
      iac: iac ? { id: iac.id, title: iac.label, description: iac.description ?? '' } : null,
    }
  })

  app.post<{ Params: { id: string } }>('/studio/builds/:id/record', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })
    if (!(await isFeatureAdmitted(featureId))) {
      return reply.status(400).send({ error: 'Case must be admitted first' })
    }
    if (!(await featureHasQaPass(featureId))) {
      return reply.status(400).send({ error: 'Quality must pass before recording a pipeline build' })
    }
    const cycle = await cycleFor(featureId)
    const body = (req.body ?? {}) as { gitSha?: string; runId?: string; conclusion?: string }
    const adapter = await createHttpAdapter(opts.platformUrl, DEVOPS_MANIFEST)
    const agent = new DevOpsAgent(adapter, opts.llm)
    return agent.run({
      featureId,
      cycleId: cycle?.id,
      gitSha: body.gitSha ?? `demo-${randomUUID().slice(0, 8)}`,
      runId: body.runId ?? `run-${Date.now()}`,
      conclusion: body.conclusion ?? 'success',
    })
  })

  // ── Ship: Safety ──────────────────────────────────────────────────────────

  app.get('/studio/safety', async () => {
    const features = await admittedFeatures()
    return Promise.all(
      features.map(async (f) => {
        const build = await latestPipelineBuild(f.feature_id)
        const scan = await queryOne<{ id: number; metadata: Record<string, unknown> }>(
          `SELECT id, metadata FROM graph_nodes
           WHERE kind='SECURITY_SCAN' AND (metadata->>'featureId')::int = $1
           ORDER BY created_at DESC LIMIT 1`,
          [f.feature_id],
        )
        const cost = await queryOne<{ id: number; metadata: Record<string, unknown> }>(
          `SELECT id, metadata FROM graph_nodes
           WHERE kind='COST_ESTIMATE'
             AND (metadata->>'gitSha') = $1
           ORDER BY created_at DESC LIMIT 1`,
          [typeof build?.metadata?.gitSha === 'string' ? build.metadata.gitSha : ''],
        )
        const blocking = Boolean(scan?.metadata?.blocking)
        const exceeds = cost
          ? Number(cost.metadata.monthlyCost ?? 0) > Number(cost.metadata.threshold ?? 500)
          : false
        let status = 'Needs safety checks'
        if (!build) status = 'Needs pipeline build'
        else if (scan && cost) {
          status = blocking || exceeds ? 'Safety blocked' : 'Safety cleared'
        }
        return {
          feature_id: f.feature_id,
          title: f.title,
          has_build: !!build,
          status,
        }
      }),
    )
  })

  app.get<{ Params: { id: string } }>('/studio/safety/:id', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })
    const admitted = await isFeatureAdmitted(featureId)
    const build = admitted ? await latestPipelineBuild(featureId) : null
    const scan = await queryOne<{
      id: number
      label: string
      description: string | null
      metadata: Record<string, unknown>
    }>(
      `SELECT id, label, description, metadata FROM graph_nodes
       WHERE kind='SECURITY_SCAN' AND (metadata->>'featureId')::int = $1
       ORDER BY created_at DESC LIMIT 1`,
      [featureId],
    )
    const findings = scan
      ? await query<{ id: number; label: string; description: string | null; metadata: Record<string, unknown> }>(
          `SELECT n.id, n.label, n.description, n.metadata FROM graph_nodes n
           JOIN graph_edges ge ON ge.to_node_id = n.id AND ge.kind IN ('EVIDENCED_BY','BLOCKS_RELEASE')
           WHERE ge.from_node_id = $1 AND n.kind='CVE_FINDING'
           ORDER BY n.created_at`,
          [scan.id],
        )
      : []
    const cost = build
      ? await queryOne<{
          id: number
          label: string
          description: string | null
          metadata: Record<string, unknown>
        }>(
          `SELECT id, label, description, metadata FROM graph_nodes
           WHERE kind='COST_ESTIMATE' AND metadata->>'gitSha' = $1
           ORDER BY created_at DESC LIMIT 1`,
          [String(build.metadata?.gitSha ?? '')],
        )
      : null
    const blocking = Boolean(scan?.metadata?.blocking)
    const exceeds = cost
      ? Number(cost.metadata.monthlyCost ?? 0) > Number(cost.metadata.threshold ?? 500)
      : false
    return {
      feature_id: feature.id,
      title: feature.label,
      admitted,
      has_build: !!build,
      status: !admitted
        ? 'Not admitted'
        : !build
          ? 'Needs pipeline build'
          : scan && cost
            ? blocking || exceeds
              ? 'Safety blocked'
              : 'Safety cleared'
            : 'Needs safety checks',
      scan: scan
        ? {
            id: scan.id,
            title: scan.label,
            blocking,
            critical: Number(scan.metadata.critical ?? 0),
            high: Number(scan.metadata.high ?? 0),
            summary: scan.description ?? '',
          }
        : null,
      findings: findings.map((f) => ({
        id: f.id,
        title: f.label,
        severity: f.metadata?.severity ?? 'info',
        description: f.description ?? '',
      })),
      cost: cost
        ? {
            id: cost.id,
            title: cost.label,
            monthly_cost: Number(cost.metadata.monthlyCost ?? 0),
            threshold: Number(cost.metadata.threshold ?? 500),
            exceeds,
          }
        : null,
    }
  })

  app.post<{ Params: { id: string } }>('/studio/safety/:id/run', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })
    if (!(await isFeatureAdmitted(featureId))) {
      return reply.status(400).send({ error: 'Case must be admitted first' })
    }
    const build = await latestPipelineBuild(featureId)
    if (!build) {
      return reply.status(400).send({ error: 'Record a pipeline build before safety checks' })
    }
    const cycle = await cycleFor(featureId)
    const gitSha = String(build.metadata?.gitSha ?? `sha-${featureId}`)
    const runId = String(build.metadata?.runId ?? `run-${featureId}`)
    const tollOs = /toll\.os|mlff/i.test(feature.label)

    const secAdapter = await createHttpAdapter(opts.platformUrl, DEVSECOPS_MANIFEST)
    const sec = new DevSecOpsAgent(secAdapter, opts.llm)
    const scan = await sec.run({
      featureId,
      cycleId: cycle?.id,
      repoPath: tollOs ? 'packages/tollos' : 'packages/app',
      gitSha,
      runId,
      fixtureFindings: [],
    })

    const finAdapter = await createHttpAdapter(opts.platformUrl, FINOPS_MANIFEST)
    const fin = new FinOpsAgent(finAdapter, opts.llm)
    const cost = await fin.run({
      cycleId: cycle?.id,
      repoPath: tollOs ? 'packages/tollos' : 'packages/app',
      gitSha,
      fixtureCost: tollOs ? 180 : 120,
      threshold: 500,
    })

    return { scan, cost }
  })

  // ── Ship: Release ─────────────────────────────────────────────────────────

  app.get('/studio/release', async () => {
    const features = await admittedFeatures()
    return Promise.all(
      features.map(async (f) => {
        const report = await queryOne<{ id: number; metadata: Record<string, unknown> }>(
          `SELECT id, metadata FROM graph_nodes
           WHERE kind='READINESS_REPORT'
             AND (
               (metadata->>'featureId')::int = $1
               OR (
                 description IS NOT NULL
                 AND left(trim(description), 1) = '{'
                 AND (description::jsonb->>'featureId')::int = $1
               )
             )
           ORDER BY created_at DESC LIMIT 1`,
          [f.feature_id],
        )
        const gate = await queryOne<{ id: number }>(
          `SELECT id FROM graph_nodes
           WHERE kind='DECISION_RECORD' AND metadata->>'gate'='RELEASE_GATE'
             AND (
               (description::jsonb->>'featureId')::int = $1
               OR (metadata->>'cycleId') IN (SELECT id::text FROM cycles WHERE feature_id = $1)
             )
           ORDER BY created_at DESC LIMIT 1`,
          [f.feature_id],
        )
        let status = 'Needs readiness check'
        if (report?.metadata?.ready === false || report?.metadata?.blocking) status = 'Not ready'
        else if (report?.metadata?.ready && gate) status = 'Release approved'
        else if (report?.metadata?.ready) status = 'Awaiting release sign-off'
        return {
          feature_id: f.feature_id,
          title: f.title,
          status,
          ready: Boolean(report?.metadata?.ready),
        }
      }),
    )
  })

  app.get<{ Params: { id: string } }>('/studio/release/:id', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })
    const admitted = await isFeatureAdmitted(featureId)
    const scan = await queryOne<{ id: number; metadata: Record<string, unknown> }>(
      `SELECT id, metadata FROM graph_nodes
       WHERE kind='SECURITY_SCAN' AND (metadata->>'featureId')::int = $1
       ORDER BY created_at DESC LIMIT 1`,
      [featureId],
    )
    const build = await latestPipelineBuild(featureId)
    const report = await queryOne<{
      id: number
      label: string
      description: string | null
      metadata: Record<string, unknown>
    }>(
      `SELECT id, label, description, metadata FROM graph_nodes
       WHERE kind='READINESS_REPORT'
         AND (
           (metadata->>'featureId')::int = $1
           OR (
             description IS NOT NULL
             AND left(trim(description), 1) = '{'
             AND (description::jsonb->>'featureId')::int = $1
           )
         )
       ORDER BY created_at DESC LIMIT 1`,
      [featureId],
    )
    let approvalSet: string[] = []
    try {
      approvalSet =
        (JSON.parse(report?.description ?? '{}') as { approvalSet?: string[] }).approvalSet ??
        (report?.metadata?.approvalSet as string[] | undefined) ??
        []
    } catch {
      approvalSet = (report?.metadata?.approvalSet as string[] | undefined) ?? []
    }
    const signed = await query<{ role: string; decision: string }>(
      `SELECT metadata->>'role' as role, metadata->>'decision' as decision
       FROM graph_nodes
       WHERE kind='DECISION_RECORD' AND metadata->>'gate'='RELEASE_GATE'
         AND (
           (description::jsonb->>'featureId')::int = $1
           OR (metadata->>'cycleId') IN (SELECT id::text FROM cycles WHERE feature_id = $1)
         )`,
      [featureId],
    )
    const ready = Boolean(report?.metadata?.ready)
    const allSigned =
      approvalSet.length === 0 ||
      approvalSet.every((role) => signed.some((s) => s.role === role))
    return {
      feature_id: feature.id,
      title: feature.label,
      admitted,
      has_safety: !!scan && !!build,
      status: !admitted
        ? 'Not admitted'
        : !scan
          ? 'Needs safety checks'
          : !report
            ? 'Needs readiness check'
            : !ready
              ? 'Not ready'
              : allSigned
                ? 'Release approved'
                : 'Awaiting release sign-off',
      report: report
        ? {
            id: report.id,
            title: report.label,
            ready,
            approval_set: approvalSet,
            signed: signed.map((s) => ({ role: s.role, decision: s.decision })),
          }
        : null,
    }
  })

  app.post<{ Params: { id: string } }>('/studio/release/:id/check', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    if (!(await isFeatureAdmitted(featureId))) {
      return reply.status(400).send({ error: 'Case must be admitted first' })
    }
    const build = await latestPipelineBuild(featureId)
    const scan = await queryOne<{ id: number }>(
      `SELECT id FROM graph_nodes
       WHERE kind='SECURITY_SCAN' AND (metadata->>'featureId')::int = $1
       ORDER BY created_at DESC LIMIT 1`,
      [featureId],
    )
    if (!build || !scan) {
      return reply.status(400).send({ error: 'Run safety checks before readiness' })
    }
    const cycle = await cycleFor(featureId)
    const adapter = await createHttpAdapter(opts.platformUrl, RELEASE_MANAGER_MANIFEST)
    const agent = new ReleaseManagerAgent(adapter, opts.llm)
    const result = await agent.run({
      featureId,
      cycleId: cycle?.id,
      buildId: build.id,
      scanNodeId: scan.id,
      environment: 'staging',
      approvedBy: 'studio',
    })
    // Ensure featureId on report metadata for queries
    if (result.reportId) {
      await query(
        `UPDATE graph_nodes
         SET metadata = COALESCE(metadata,'{}'::jsonb) || $1::jsonb
         WHERE id = $2`,
        [JSON.stringify({ featureId }), result.reportId],
      )
    }
    return result
  })

  app.post<{ Params: { id: string } }>('/studio/release/:id/approve', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })
    const report = await queryOne<{ id: number; metadata: Record<string, unknown>; description: string | null }>(
      `SELECT id, metadata, description FROM graph_nodes
       WHERE kind='READINESS_REPORT'
         AND (
           (metadata->>'featureId')::int = $1
           OR (description::jsonb->>'featureId')::int = $1
         )
       ORDER BY created_at DESC LIMIT 1`,
      [featureId],
    )
    if (!report?.metadata?.ready) {
      return reply.status(400).send({ error: 'Readiness must be ready before sign-off' })
    }
    const cycle = await cycleFor(featureId)
    let approvalSet: string[] = ['eng-lead', 'product']
    try {
      approvalSet =
        (JSON.parse(report.description ?? '{}') as { approvalSet?: string[] }).approvalSet ??
        approvalSet
    } catch {
      /* keep default */
    }
    const body = (req.body ?? {}) as { role?: string; userId?: string }
    const role = body.role ?? approvalSet[0] ?? 'product'
    const node = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('DECISION_RECORD', $1, $2, $3::jsonb)
       RETURNING id`,
      [
        `Release gate: ${role} approve`,
        JSON.stringify({
          gate: 'RELEASE_GATE',
          decision: 'approve',
          role,
          featureId,
          cycleId: cycle?.id,
        }),
        JSON.stringify({
          gate: 'RELEASE_GATE',
          decision: 'approve',
          role,
          cycleId: cycle?.id,
          featureId,
          userId: body.userId,
        }),
      ],
    )
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'APPROVES')`,
      [node!.id, featureId],
    )
    // Sign remaining roles for demo convenience when role=all
    if (body.role === 'all') {
      for (const r of approvalSet) {
        if (r === role) continue
        const n = await queryOne<{ id: number }>(
          `INSERT INTO graph_nodes (kind, label, description, metadata)
           VALUES ('DECISION_RECORD', $1, $2, $3::jsonb)
           RETURNING id`,
          [
            `Release gate: ${r} approve`,
            JSON.stringify({ gate: 'RELEASE_GATE', decision: 'approve', role: r, featureId }),
            JSON.stringify({
              gate: 'RELEASE_GATE',
              decision: 'approve',
              role: r,
              cycleId: cycle?.id,
              featureId,
            }),
          ],
        )
        await query(
          `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'APPROVES')`,
          [n!.id, featureId],
        )
      }
    }
    if (cycle?.id && opts.orchestrator) {
      await opts.orchestrator.advance(cycle.id).catch(() => null)
    }
    return { nodeId: node!.id, role }
  })

  // ── Ship: Rollout ─────────────────────────────────────────────────────────

  app.get('/studio/rollout', async () => {
    const features = await admittedFeatures()
    return Promise.all(
      features.map(async (f) => {
        const dep = await queryOne<{ id: number; metadata: Record<string, unknown> }>(
          `SELECT d.id, d.metadata FROM graph_nodes d
           JOIN graph_edges ge ON ge.to_node_id = d.id AND ge.kind='DEPLOYS_TO'
           JOIN graph_nodes r ON r.id = ge.from_node_id AND r.kind='READINESS_REPORT'
           WHERE (r.metadata->>'featureId')::int = $1
              OR (r.description::jsonb->>'featureId')::int = $1
           ORDER BY d.created_at DESC LIMIT 1`,
          [f.feature_id],
        )
        const obs = await queryOne<{ n: string }>(
          `SELECT COUNT(*)::text as n FROM graph_nodes
           WHERE kind='KPI_OBSERVATION'
             AND (
               metadata->>'service' ILIKE '%toll%'
               OR (metadata->>'featureId')::int = $1
             )`,
          [f.feature_id],
        )
        let status = 'Needs rollout'
        if (dep) {
          const st = String(dep.metadata.status ?? '')
          if (st === 'deployed' && Number(obs?.n ?? 0) > 0) status = 'Healthy in production'
          else if (st === 'deployed') status = 'Deployed — watch metrics'
          else if (st === 'failed') status = 'Deploy failed'
          else status = 'Rollout recorded'
        }
        return { feature_id: f.feature_id, title: f.title, status }
      }),
    )
  })

  app.get<{ Params: { id: string } }>('/studio/rollout/:id', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })
    const admitted = await isFeatureAdmitted(featureId)
    const report = await queryOne<{ id: number; metadata: Record<string, unknown> }>(
      `SELECT id, metadata FROM graph_nodes
       WHERE kind='READINESS_REPORT'
         AND (
           (metadata->>'featureId')::int = $1
           OR (description::jsonb->>'featureId')::int = $1
         )
       ORDER BY created_at DESC LIMIT 1`,
      [featureId],
    )
    const gateOk = await queryOne<{ n: string }>(
      `SELECT COUNT(*)::text as n FROM graph_nodes
       WHERE kind='DECISION_RECORD' AND metadata->>'gate'='RELEASE_GATE'
         AND (
           (description::jsonb->>'featureId')::int = $1
           OR (metadata->>'cycleId') IN (SELECT id::text FROM cycles WHERE feature_id = $1)
         )`,
      [featureId],
    )
    const dep = report
      ? await queryOne<{
          id: number
          label: string
          description: string | null
          metadata: Record<string, unknown>
        }>(
          `SELECT d.id, d.label, d.description, d.metadata FROM graph_nodes d
           JOIN graph_edges ge ON ge.to_node_id = d.id AND ge.kind='DEPLOYS_TO'
           WHERE ge.from_node_id = $1 AND d.kind='DEPLOYMENT'
           ORDER BY d.created_at DESC LIMIT 1`,
          [report.id],
        )
      : null
    const env = dep
      ? await queryOne<{ id: number; label: string }>(
          `SELECT n.id, n.label FROM graph_nodes n
           JOIN graph_edges ge ON ge.to_node_id = n.id AND ge.kind='DEPLOYS_TO'
           WHERE ge.from_node_id = $1 AND n.kind='ENV_TARGET'
           LIMIT 1`,
          [dep.id],
        )
      : null
    const observations = dep
      ? await query<{
          id: number
          label: string
          metadata: Record<string, unknown>
        }>(
          `SELECT n.id, n.label, n.metadata FROM graph_nodes n
           JOIN graph_edges ge ON ge.from_node_id = n.id AND ge.kind='MEASURES'
           WHERE ge.to_node_id = $1 AND n.kind='KPI_OBSERVATION'
           ORDER BY n.created_at DESC`,
          [dep.id],
        )
      : []
    return {
      feature_id: feature.id,
      title: feature.label,
      admitted,
      release_ready: Boolean(report?.metadata?.ready) && Number(gateOk?.n ?? 0) > 0,
      status: !admitted
        ? 'Not admitted'
        : !report?.metadata?.ready
          ? 'Needs release approval'
          : !dep
            ? 'Needs rollout'
            : observations.length
              ? 'Healthy in production'
              : 'Deployed — watch metrics',
      deployment: dep
        ? {
            id: dep.id,
            title: dep.label,
            status: dep.metadata.status ?? null,
            environment: env?.label ?? dep.metadata.environment ?? null,
          }
        : null,
      observations: observations.map((o) => ({
        id: o.id,
        label: o.label,
        sli: o.metadata.sli ?? null,
        target: o.metadata.target ?? null,
        healthy: Boolean(o.metadata.healthy),
      })),
    }
  })

  app.post<{ Params: { id: string } }>('/studio/rollout/:id/deploy', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const report = await queryOne<{ id: number; metadata: Record<string, unknown> }>(
      `SELECT id, metadata FROM graph_nodes
       WHERE kind='READINESS_REPORT'
         AND (
           (metadata->>'featureId')::int = $1
           OR (description::jsonb->>'featureId')::int = $1
         )
       ORDER BY created_at DESC LIMIT 1`,
      [featureId],
    )
    if (!report?.metadata?.ready) {
      return reply.status(400).send({ error: 'Release must be ready before rollout' })
    }
    const cycle = await cycleFor(featureId)
    const body = (req.body ?? {}) as { environment?: string; status?: 'deployed' | 'failed' | 'rolled_back' }
    const adapter = await createHttpAdapter(opts.platformUrl, DEPLOYMENT_ENGINEER_MANIFEST)
    const agent = new DeploymentEngineerAgent(adapter, opts.llm)
    return agent.run({
      reportId: report.id,
      cycleId: cycle?.id,
      environment: body.environment ?? 'production',
      status: body.status ?? 'deployed',
    })
  })

  app.post<{ Params: { id: string } }>('/studio/rollout/:id/observe', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })
    const report = await queryOne<{ id: number }>(
      `SELECT id FROM graph_nodes
       WHERE kind='READINESS_REPORT'
         AND (
           (metadata->>'featureId')::int = $1
           OR (description::jsonb->>'featureId')::int = $1
         )
       ORDER BY created_at DESC LIMIT 1`,
      [featureId],
    )
    const dep = report
      ? await queryOne<{ id: number }>(
          `SELECT d.id FROM graph_nodes d
           JOIN graph_edges ge ON ge.to_node_id = d.id AND ge.kind='DEPLOYS_TO'
           WHERE ge.from_node_id = $1 AND d.kind='DEPLOYMENT'
           ORDER BY d.created_at DESC LIMIT 1`,
          [report.id],
        )
      : null
    if (!dep) return reply.status(400).send({ error: 'Deploy before observing health' })
    const cycle = await cycleFor(featureId)
    const tollOs = /toll\.os|mlff/i.test(feature.label)
    const adapter = await createHttpAdapter(opts.platformUrl, SRE_MANIFEST)
    const agent = new SreAgent(adapter, opts.llm)
    const results = []
    for (const kpi of tollOs
      ? [
          { kpiLabel: 'Billable events / day', sli: 0.995 },
          { kpiLabel: 'Double-bill rate', sli: 0.999 },
        ]
      : [{ kpiLabel: 'Service SLI', sli: 0.995 }]) {
      results.push(
        await agent.run({
          service: tollOs ? 'tollos-metering' : `feature-${featureId}`,
          sliWindow: '7d',
          target: 0.99,
          fixtureMetrics: { sli: kpi.sli },
          kpiLabel: kpi.kpiLabel,
          deploymentId: dep.id,
          cycleId: cycle?.id,
        }),
      )
    }
    // Tag observations with featureId
    await query(
      `UPDATE graph_nodes SET metadata = COALESCE(metadata,'{}'::jsonb) || $1::jsonb
       WHERE kind='KPI_OBSERVATION' AND id = ANY($2::int[])`,
      [JSON.stringify({ featureId }), results.map((r) => r.observationId)],
    )
    return { observations: results }
  })

  // ── Learn: Outcomes ───────────────────────────────────────────────────────

  app.get('/studio/outcomes', async () => {
    const features = await admittedFeatures()
    return Promise.all(
      features.map(async (f) => {
        const verdict = await queryOne<{ id: number }>(
          `SELECT v.id FROM graph_nodes v
           JOIN graph_edges ge ON ge.from_node_id = v.id AND ge.kind='ATTRIBUTES'
           WHERE ge.to_node_id = $1 AND v.kind='HYPOTHESIS_VERDICT'
           ORDER BY v.created_at DESC LIMIT 1`,
          [f.feature_id],
        )
        const obs = await queryOne<{ n: string }>(
          `SELECT COUNT(*)::text as n FROM graph_nodes
           WHERE kind='KPI_OBSERVATION' AND (metadata->>'featureId')::int = $1`,
          [f.feature_id],
        )
        let status = 'Needs outcomes'
        if (!Number(obs?.n ?? 0)) status = 'Needs live metrics'
        else if (verdict) status = 'Outcomes judged'
        return {
          feature_id: f.feature_id,
          title: f.title,
          status,
        }
      }),
    )
  })

  app.get<{ Params: { id: string } }>('/studio/outcomes/:id', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })
    const admitted = await isFeatureAdmitted(featureId)
    const observations = await query<{
      id: number
      label: string
      metadata: Record<string, unknown>
    }>(
      `SELECT id, label, metadata FROM graph_nodes
       WHERE kind='KPI_OBSERVATION' AND (metadata->>'featureId')::int = $1
       ORDER BY created_at DESC`,
      [featureId],
    )
    const verdict = await queryOne<{
      id: number
      label: string
      description: string | null
    }>(
      `SELECT v.id, v.label, v.description FROM graph_nodes v
       JOIN graph_edges ge ON ge.from_node_id = v.id AND ge.kind='ATTRIBUTES'
       WHERE ge.to_node_id = $1 AND v.kind='HYPOTHESIS_VERDICT'
       ORDER BY v.created_at DESC LIMIT 1`,
      [featureId],
    )
    const outcomes = verdict
      ? await query<{ id: number; label: string; description: string | null; metadata: Record<string, unknown> }>(
          `SELECT o.id, o.label, o.description, o.metadata FROM graph_nodes o
           JOIN graph_edges ge ON ge.to_node_id = o.id AND ge.kind='REALIZED'
           WHERE ge.from_node_id = $1 AND o.kind='OUTCOME'
           ORDER BY o.created_at`,
          [verdict.id],
        )
      : []
    return {
      feature_id: feature.id,
      title: feature.label,
      admitted,
      has_metrics: observations.length > 0,
      status: !admitted
        ? 'Not admitted'
        : !observations.length
          ? 'Needs live metrics'
          : verdict
            ? 'Outcomes judged'
            : 'Needs outcomes',
      verdict: verdict
        ? { id: verdict.id, title: verdict.label, summary: verdict.description ?? '' }
        : null,
      outcomes: outcomes.map((o) => ({
        id: o.id,
        label: o.label,
        kpi: o.metadata.kpi ?? null,
        value: o.metadata.value ?? null,
      })),
      observations: observations.map((o) => ({
        id: o.id,
        label: o.label,
        sli: o.metadata.sli ?? null,
      })),
    }
  })

  app.post<{ Params: { id: string } }>('/studio/outcomes/:id/judge', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    if (!(await isFeatureAdmitted(featureId))) {
      return reply.status(400).send({ error: 'Case must be admitted first' })
    }
    const observations = await query<{ label: string; metadata: Record<string, unknown> }>(
      `SELECT label, metadata FROM graph_nodes
       WHERE kind='KPI_OBSERVATION' AND (metadata->>'featureId')::int = $1`,
      [featureId],
    )
    if (!observations.length) {
      return reply.status(400).send({ error: 'Observe live metrics before judging outcomes' })
    }
    const body = (req.body ?? {}) as { kpiActuals?: Record<string, number> }
    const kpiActuals =
      body.kpiActuals ??
      Object.fromEntries(
        observations.map((o, i) => [
          o.label || `kpi_${i}`,
          Number(o.metadata.sli ?? 1) * (o.label.includes('Double') ? 0.05 : 1_200_000),
        ]),
      )
    // Toll.OS demo actuals in business units
    const feature = await queryOne<{ label: string }>(
      `SELECT label FROM graph_nodes WHERE id=$1`,
      [featureId],
    )
    const actuals =
      body.kpiActuals ??
      (/toll\.os|mlff/i.test(feature?.label ?? '')
        ? {
            'Billable events / day': 1_180_000,
            'Double-bill rate': 0.04,
            'Annual metering revenue ₹M': 9.2,
          }
        : kpiActuals)

    const cycle = await cycleFor(featureId)
    const adapter = await createHttpAdapter(opts.platformUrl, ATTRIBUTION_ANALYST_MANIFEST)
    const agent = new AttributionAnalystAgent(adapter, opts.llm)
    return agent.run({ featureId, cycleId: cycle?.id, kpiActuals: actuals })
  })

  // ── Learn: Impact ─────────────────────────────────────────────────────────

  app.get('/studio/impact', async () => {
    const features = await admittedFeatures()
    return Promise.all(
      features.map(async (f) => {
        const verdict = await queryOne<{ id: number }>(
          `SELECT v.id FROM graph_nodes v
           JOIN graph_edges ge ON ge.from_node_id = v.id AND ge.kind='ATTRIBUTES'
           WHERE ge.to_node_id = $1 AND v.kind='HYPOTHESIS_VERDICT'
           LIMIT 1`,
          [f.feature_id],
        )
        const impact = await queryOne<{ id: number }>(
          `SELECT a.id FROM graph_nodes a
           JOIN graph_edges ge ON ge.from_node_id = a.id AND ge.kind='IMPACTS'
           WHERE ge.to_node_id = $1 AND a.kind='IMPACT_ASSESSMENT'
           LIMIT 1`,
          [f.feature_id],
        )
        let status = 'Needs impact assessment'
        if (!verdict) status = 'Needs outcomes first'
        else if (impact) status = 'Impact assessed'
        return { feature_id: f.feature_id, title: f.title, status }
      }),
    )
  })

  app.get<{ Params: { id: string } }>('/studio/impact/:id', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })
    const admitted = await isFeatureAdmitted(featureId)
    const verdict = await queryOne<{ id: number }>(
      `SELECT v.id FROM graph_nodes v
       JOIN graph_edges ge ON ge.from_node_id = v.id AND ge.kind='ATTRIBUTES'
       WHERE ge.to_node_id = $1 AND v.kind='HYPOTHESIS_VERDICT'
       LIMIT 1`,
      [featureId],
    )
    const assessment = await queryOne<{
      id: number
      label: string
      description: string | null
    }>(
      `SELECT a.id, a.label, a.description FROM graph_nodes a
       JOIN graph_edges ge ON ge.from_node_id = a.id AND ge.kind='IMPACTS'
       WHERE ge.to_node_id = $1 AND a.kind='IMPACT_ASSESSMENT'
       ORDER BY a.created_at DESC LIMIT 1`,
      [featureId],
    )
    const sentiments = assessment
      ? await query<{ id: number; label: string; description: string | null; metadata: Record<string, unknown> }>(
          `SELECT s.id, s.label, s.description, s.metadata FROM graph_nodes s
           JOIN graph_edges ge ON ge.to_node_id = s.id AND ge.kind='IMPACTS'
           WHERE ge.from_node_id = $1 AND s.kind='SENTIMENT'
           ORDER BY s.created_at`,
          [assessment.id],
        )
      : []
    return {
      feature_id: feature.id,
      title: feature.label,
      admitted,
      has_verdict: !!verdict,
      status: !admitted
        ? 'Not admitted'
        : !verdict
          ? 'Needs outcomes first'
          : assessment
            ? 'Impact assessed'
            : 'Needs impact assessment',
      assessment: assessment
        ? {
            id: assessment.id,
            title: assessment.label,
            summary: assessment.description ?? '',
          }
        : null,
      sentiments: sentiments.map((s) => ({
        id: s.id,
        stakeholder: s.label,
        sentiment: s.metadata?.sentiment ?? 'neutral',
        text: s.description ?? '',
      })),
    }
  })

  app.post<{ Params: { id: string } }>('/studio/impact/:id/assess', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })
    const verdict = await queryOne<{ id: number }>(
      `SELECT v.id FROM graph_nodes v
       JOIN graph_edges ge ON ge.from_node_id = v.id AND ge.kind='ATTRIBUTES'
       WHERE ge.to_node_id = $1 AND v.kind='HYPOTHESIS_VERDICT'
       LIMIT 1`,
      [featureId],
    )
    if (!verdict) return reply.status(400).send({ error: 'Judge outcomes before assessing impact' })
    const cycle = await cycleFor(featureId)
    const body = (req.body ?? {}) as {
      feedback?: Array<{ stakeholder: string; text: string }>
    }
    const tollOs = /toll\.os|mlff/i.test(feature.label)
    const feedback =
      body.feedback ??
      (tollOs
        ? [
            {
              stakeholder: 'National toll concessionaire',
              text: 'Corridor invoice finally matches ANPR and FASTag activity — ₹5 events look right.',
            },
            {
              stakeholder: 'Bosch MPS commercial',
              text: 'Revenue recognition on MLFF metering is clean; double-bills dropped to near zero.',
            },
            {
              stakeholder: 'Roadside ops',
              text: 'LiDAR exceptions no longer vanish — they open workflows and still meter when resolved.',
            },
          ]
        : [
            {
              stakeholder: 'Uffizio',
              text: 'Afternoon dock waves finally trust StaaS stock — loyalty earn lands with the same logistics events.',
            },
          ])
    const adapter = await createHttpAdapter(opts.platformUrl, STAKEHOLDER_IMPACT_MANIFEST)
    const agent = new StakeholderImpactAgent(adapter, opts.llm)
    return agent.run({ featureId, cycleId: cycle?.id, feedback })
  })

  // ── Learn: Lessons + close loop ───────────────────────────────────────────

  app.get('/studio/lessons', async () => {
    const features = await admittedFeatures()
    return Promise.all(
      features.map(async (f) => {
        const closed = await queryOne<{ v: string }>(
          `SELECT metadata->>'cycleClosed' as v FROM graph_nodes WHERE id=$1`,
          [f.feature_id],
        )
        const learning = await queryOne<{ n: string }>(
          `SELECT COUNT(*)::text as n FROM graph_nodes l
           JOIN graph_edges ge ON ge.from_node_id = l.id AND ge.kind='DERIVED_FROM'
           JOIN graph_nodes v ON v.id = ge.to_node_id AND v.kind='HYPOTHESIS_VERDICT'
           JOIN graph_edges va ON va.from_node_id = v.id AND va.kind='ATTRIBUTES'
           WHERE l.kind='LEARNING' AND va.to_node_id = $1`,
          [f.feature_id],
        )
        const verdict = await queryOne<{ id: number }>(
          `SELECT v.id FROM graph_nodes v
           JOIN graph_edges ge ON ge.from_node_id = v.id AND ge.kind='ATTRIBUTES'
           WHERE ge.to_node_id = $1 AND v.kind='HYPOTHESIS_VERDICT'
           LIMIT 1`,
          [f.feature_id],
        )
        let status = 'Needs lessons'
        if (closed?.v === 'true') status = 'Cycle closed'
        else if (Number(learning?.n ?? 0) > 0) status = 'Lessons captured'
        else if (!verdict) status = 'Needs outcomes first'
        return { feature_id: f.feature_id, title: f.title, status }
      }),
    )
  })

  app.get<{ Params: { id: string } }>('/studio/lessons/:id', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{
      id: number
      label: string
      metadata: Record<string, unknown>
    }>(`SELECT id, label, metadata FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`, [featureId])
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })
    const admitted = await isFeatureAdmitted(featureId)
    const verdicts = await query<{ id: number; label: string }>(
      `SELECT v.id, v.label FROM graph_nodes v
       JOIN graph_edges ge ON ge.from_node_id = v.id AND ge.kind='ATTRIBUTES'
       WHERE ge.to_node_id = $1 AND v.kind='HYPOTHESIS_VERDICT'
       ORDER BY v.created_at DESC`,
      [featureId],
    )
    const verdictIds = verdicts.map((v) => v.id)
    const learnings =
      verdictIds.length === 0
        ? []
        : await query<{ id: number; label: string; description: string | null }>(
            `SELECT l.id, l.label, l.description
             FROM graph_nodes l
             WHERE l.kind='LEARNING'
               AND EXISTS (
                 SELECT 1 FROM graph_edges ge
                 WHERE ge.from_node_id = l.id
                   AND ge.kind='DERIVED_FROM'
                   AND ge.to_node_id = ANY($1::int[])
               )
             ORDER BY l.created_at DESC`,
            [verdictIds],
          )
    const calibrations = await query<{
      id: number
      label: string
      description: string | null
      metadata: Record<string, unknown>
    }>(
      `SELECT id, label, description, metadata FROM graph_nodes
       WHERE kind='CALIBRATION_RECORD' AND (metadata->>'featureId')::int = $1
       ORDER BY created_at DESC`,
      [featureId],
    )
    const calibrationIds = calibrations.map((c) => c.id)
    const drifts =
      calibrationIds.length === 0
        ? []
        : await query<{ id: number; label: string; description: string | null }>(
            `SELECT d.id, d.label, d.description FROM graph_nodes d
             JOIN graph_edges ge ON ge.from_node_id = d.id AND ge.kind='CALIBRATES'
             WHERE d.kind='DRIFT_ALERT' AND ge.to_node_id = ANY($1::int[])
             ORDER BY d.created_at DESC`,
            [calibrationIds],
          )
    const cycle = await cycleFor(featureId)
    const closed = feature.metadata?.cycleClosed === true
    return {
      feature_id: feature.id,
      title: feature.label,
      admitted,
      has_verdict: verdicts.length > 0,
      cycle_stage: cycle?.current_stage ?? null,
      closed,
      status: closed
        ? 'Cycle closed'
        : !verdicts.length
          ? 'Needs outcomes first'
          : learnings.length
            ? 'Lessons captured'
            : 'Needs lessons',
      learnings: learnings.map((l) => ({
        id: l.id,
        title: l.label,
        body: l.description ?? '',
      })),
      calibrations: calibrations.map((c) => ({
        id: c.id,
        title: c.label,
        body: c.description ?? '',
        error_pct: c.metadata?.errorPct ?? null,
      })),
      drifts: drifts.map((d) => ({
        id: d.id,
        title: d.label,
        body: d.description ?? '',
      })),
    }
  })

  app.post<{ Params: { id: string } }>('/studio/lessons/:id/capture', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const verdicts = await query<{ id: number }>(
      `SELECT v.id FROM graph_nodes v
       JOIN graph_edges ge ON ge.from_node_id = v.id AND ge.kind='ATTRIBUTES'
       WHERE ge.to_node_id = $1 AND v.kind='HYPOTHESIS_VERDICT'`,
      [featureId],
    )
    if (!verdicts.length) {
      return reply.status(400).send({ error: 'Judge outcomes before capturing lessons' })
    }
    const cycle = await cycleFor(featureId)
    const adapter = await createHttpAdapter(opts.platformUrl, ORGANIZATIONAL_LEARNING_MANIFEST)
    const agent = new OrganizationalLearningAgent(adapter, opts.llm)
    return agent.run({
      verdictIds: verdicts.map((v) => v.id),
      cycleId: cycle?.id,
    })
  })

  app.post<{ Params: { id: string } }>('/studio/lessons/:id/close', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    const feature = await queryOne<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1 AND kind='FEATURE'`,
      [featureId],
    )
    if (!feature) return reply.status(404).send({ error: 'Business case not found' })

    const verdicts = await query<{ id: number }>(
      `SELECT v.id FROM graph_nodes v
       JOIN graph_edges ge ON ge.from_node_id = v.id AND ge.kind='ATTRIBUTES'
       WHERE ge.to_node_id = $1 AND v.kind='HYPOTHESIS_VERDICT'`,
      [featureId],
    )
    if (!verdicts.length) {
      return reply.status(400).send({ error: 'Judge outcomes before closing the loop' })
    }

    const cycle = await cycleFor(featureId)
    if (!cycle?.id) {
      return reply.status(400).send({ error: 'No cycle found for this case' })
    }

    // Capture lessons if missing
    let learningResult: unknown = null
    const existingLessons = await queryOne<{ n: string }>(
      `SELECT COUNT(*)::text as n FROM graph_nodes l
       JOIN graph_edges ge ON ge.from_node_id = l.id AND ge.kind='DERIVED_FROM'
       WHERE l.kind='LEARNING' AND ge.to_node_id = ANY($1::int[])`,
      [verdicts.map((v) => v.id)],
    )
    if (Number(existingLessons?.n ?? 0) === 0) {
      const learnAdapter = await createHttpAdapter(
        opts.platformUrl,
        ORGANIZATIONAL_LEARNING_MANIFEST,
      )
      learningResult = await new OrganizationalLearningAgent(learnAdapter, opts.llm).run({
        verdictIds: verdicts.map((v) => v.id),
        cycleId: cycle.id,
      })
    }

    // Calibrate value estimate vs realized annual revenue
    const valueNode = await queryOne<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM graph_nodes
       WHERE kind='VALUE_ASSESSMENT'
         AND (
           (metadata->>'featureId')::int = $1
           OR EXISTS (
             SELECT 1 FROM graph_edges ge
             WHERE ge.to_node_id = graph_nodes.id AND ge.from_node_id = $1
           )
         )
       ORDER BY created_at DESC LIMIT 1`,
      [featureId],
    )
    const predicted =
      Number(valueNode?.metadata?.mid ?? valueNode?.metadata?.expectedAnnualValue ?? 9_000_000) ||
      9_000_000
    const actual = /toll\.os|mlff/i.test(feature.label) ? 9_200_000 : predicted * 0.95

    const calAdapter = await createHttpAdapter(opts.platformUrl, CALIBRATION_MANIFEST)
    const calibration = await new CalibrationAgent(calAdapter, opts.llm).run({
      targetAgentId: 'value-engineering:v1',
      cycleId: cycle.id,
      predictedValue: predicted,
      actualValue: actual,
      kpi: 'annual_value_eur',
      featureId,
    })

    // Mark feature + cycle closed — feeds next Listen cycle
    await query(
      `UPDATE graph_nodes
       SET metadata = COALESCE(metadata,'{}'::jsonb) || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2`,
      [
        JSON.stringify({
          cycleClosed: true,
          closedAt: Date.now(),
          closedCycleId: cycle.id,
          loopClosed: true,
        }),
        featureId,
      ],
    )
    await query(
      `UPDATE cycles SET current_stage = 'DONE', updated_at = NOW() WHERE id = $1`,
      [cycle.id],
    )

    // Write a loop-back signal so Listen can surface the lesson
    const loopSignal = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('LEARNING', $1, $2, $3::jsonb)
       RETURNING id`,
      [
        `Loop closed: ${feature.label.slice(0, 80)}`,
        'Cycle complete. Value calibration and lessons are ready for the next Listen → Decide pass.',
        JSON.stringify({
          featureId,
          cycleId: cycle.id,
          loopClosed: true,
          feedsListen: true,
          calibrationId: calibration.recordId,
        }),
      ],
    )
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind)
       VALUES ($1,$2,'DERIVED_FROM')
       ON CONFLICT DO NOTHING`,
      [loopSignal!.id, verdicts[0]!.id],
    ).catch(async () => {
      await query(
        `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'DERIVED_FROM')`,
        [loopSignal!.id, verdicts[0]!.id],
      )
    })

    if (opts.orchestrator) {
      await opts.orchestrator.advance(cycle.id).catch(() => null)
    }

    return {
      closed: true,
      cycleId: cycle.id,
      stage: 'DONE',
      learningResult,
      calibration,
      loopSignalId: loopSignal!.id,
      next: {
        listen: '/pain-points',
        decide: '/business-cases',
        message:
          'Loop closed. Lessons and calibration feed the next Listen → Decide cycle.',
      },
    }
  })

  // Home: closed cycles / lessons ready
  app.get('/studio/loop/closed', async () => {
    const rows = await query<{
      feature_id: number
      title: string
      closed_at: string | null
    }>(
      `SELECT id as feature_id, label as title, metadata->>'closedAt' as closed_at
       FROM graph_nodes
       WHERE kind='FEATURE' AND COALESCE((metadata->>'cycleClosed')::boolean, false) = true
       ORDER BY updated_at DESC
       LIMIT 10`,
    )
    return { count: rows.length, items: rows }
  })
}
