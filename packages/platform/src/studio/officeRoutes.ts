import type { FastifyInstance } from 'fastify'
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from 'd3-force'
import type { AgentManifest } from '@avp/shared'
import { VOC_MANIFEST } from '@avp/agents-listen-voc-intelligence'
import { MARKET_SIGNAL_MANIFEST } from '@avp/agents-listen-market-signal'
import { BUSINESS_CASE_MANIFEST } from '@avp/agents-decide-business-case'
import { VALUE_ENGINEERING_MANIFEST } from '@avp/agents-decide-value-engineering'
import { SOLUTIONS_ESTIMATION_MANIFEST } from '@avp/agents-decide-solutions-estimation'
import { PRODUCT_STRATEGY_MANIFEST } from '@avp/agents-decide-product-strategy'
import { PORTFOLIO_MANAGEMENT_MANIFEST } from '@avp/agents-decide-portfolio-management'
import { REQUIREMENTS_ANALYST_MANIFEST } from '@avp/agents-define-requirements-analyst'
import { DOMAIN_STEWARD_MANIFEST } from '@avp/agents-define-domain-steward'
import { SOLUTIONS_ARCHITECT_MANIFEST } from '@avp/agents-define-solutions-architect'
import { SOFTWARE_ENGINEERING_MANIFEST } from '@avp/agents-build-software-engineering'
import { QUALITY_ENGINEERING_MANIFEST } from '@avp/agents-build-quality-engineering'
import { DOCUMENTATION_MANIFEST } from '@avp/agents-build-documentation'
import { DEVOPS_MANIFEST } from '@avp/agents-ship-devops'
import { DEVSECOPS_MANIFEST } from '@avp/agents-ship-devsecops'
import { FINOPS_MANIFEST } from '@avp/agents-ship-finops'
import { RELEASE_MANAGER_MANIFEST } from '@avp/agents-ship-release-manager'
import { DEPLOYMENT_ENGINEER_MANIFEST } from '@avp/agents-ship-deployment-engineer'
import { SRE_MANIFEST } from '@avp/agents-ship-sre'
import { ATTRIBUTION_ANALYST_MANIFEST } from '@avp/agents-learn-attribution-analyst'
import { STAKEHOLDER_IMPACT_MANIFEST } from '@avp/agents-learn-stakeholder-impact'
import { ORGANIZATIONAL_LEARNING_MANIFEST } from '@avp/agents-learn-organizational-learning'
import { CALIBRATION_MANIFEST } from '@avp/agents-learn-calibration'
import { query } from '../db/pool.js'
import type { ContextBus } from '../bus/contextBus.js'

const DOMAIN_TO_DEPT: Record<string, string> = {
  listen: 'mkt',
  decide: 'cor',
  define: 'px',
  build: 'eng',
  ship: 'gtm',
  learn: 'cx',
}

const LEAD_IDS = new Set([
  'voc-intelligence:v1',
  'portfolio-management:v1',
  'requirements-analyst:v1',
  'software-engineering:v1',
  'release-manager:v1',
  'calibration:v1',
])

const MANIFESTS: AgentManifest[] = [
  VOC_MANIFEST,
  MARKET_SIGNAL_MANIFEST,
  PORTFOLIO_MANAGEMENT_MANIFEST,
  BUSINESS_CASE_MANIFEST,
  VALUE_ENGINEERING_MANIFEST,
  SOLUTIONS_ESTIMATION_MANIFEST,
  PRODUCT_STRATEGY_MANIFEST,
  REQUIREMENTS_ANALYST_MANIFEST,
  DOMAIN_STEWARD_MANIFEST,
  SOLUTIONS_ARCHITECT_MANIFEST,
  SOFTWARE_ENGINEERING_MANIFEST,
  QUALITY_ENGINEERING_MANIFEST,
  DOCUMENTATION_MANIFEST,
  RELEASE_MANAGER_MANIFEST,
  DEVOPS_MANIFEST,
  DEVSECOPS_MANIFEST,
  FINOPS_MANIFEST,
  DEPLOYMENT_ENGINEER_MANIFEST,
  SRE_MANIFEST,
  CALIBRATION_MANIFEST,
  ATTRIBUTION_ANALYST_MANIFEST,
  STAKEHOLDER_IMPACT_MANIFEST,
  ORGANIZATIONAL_LEARNING_MANIFEST,
]

const KIND_TO_PHASE: Record<string, string> = {
  CUSTOMER_SIGNAL: 'listen',
  PAIN_POINT: 'listen',
  MARKET_SIGNAL: 'listen',
  COMPETITOR_MOVE: 'listen',
  REGULATORY_SIGNAL: 'listen',
  TREND: 'listen',
  BUSINESS_CASE: 'decide',
  KPI_TARGET: 'decide',
  VALUE_MODEL: 'decide',
  VALUE_LEVER: 'decide',
  HYPOTHESIS: 'decide',
  STRATEGY_BET: 'decide',
  ESTIMATE: 'decide',
  EFFORT_BAND: 'decide',
  PORTFOLIO_DECISION: 'decide',
  FEATURE: 'decide',
  BRIEF: 'decide',
  BUSINESS_IMPACT: 'decide',
  VALUE_HYPOTHESIS: 'decide',
  GTM_PROJECTION: 'decide',
  SEGMENT: 'decide',
  DEV_IMPACT: 'decide',
  EFFORT_ESTIMATE: 'decide',
  PORTFOLIO_PACKET: 'decide',
  DECISION_RECORD: 'decide',
  REQUIREMENT: 'define',
  ACCEPTANCE_CRITERION: 'define',
  USER_STORY: 'define',
  DOMAIN_CONCEPT: 'define',
  GLOSSARY_TERM: 'define',
  KPI: 'define',
  REGULATION: 'define',
  BUSINESS_RULE: 'define',
  ARCHITECTURE: 'define',
  COMPONENT: 'define',
  INTERFACE: 'define',
  BOUNDED_CONTEXT: 'define',
  SERVICE_INTERFACE: 'define',
  CODE_ARTIFACT: 'build',
  CHANGESET: 'build',
  CODE_FILE: 'build',
  IMPLEMENTATION_NOTE: 'build',
  TEST_EVIDENCE: 'build',
  DEFECT: 'build',
  TEST_SUITE: 'build',
  TEST_CASE: 'build',
  TEST_RUN: 'build',
  DOCUMENTATION: 'build',
  RUNBOOK_STUB: 'build',
  CHANGELOG: 'build',
  SECURITY_SCAN: 'ship',
  CVE_FINDING: 'ship',
  COMPLIANCE_CHECK: 'ship',
  BUILD_RUN: 'ship',
  PIPELINE_STEP: 'ship',
  BUILD: 'ship',
  IAC_CHANGESET: 'ship',
  COST_FORECAST: 'ship',
  COST_ANOMALY: 'ship',
  COST_ESTIMATE: 'ship',
  COST_ALERT: 'ship',
  RELEASE_CANDIDATE: 'ship',
  RELEASE_NOTE: 'ship',
  READINESS_REPORT: 'ship',
  DEPLOYMENT: 'ship',
  ENV_TARGET: 'ship',
  SLO: 'ship',
  SLO_BREACH: 'ship',
  INCIDENT: 'ship',
  KPI_OBSERVATION: 'ship',
  NOTIFICATION: 'ship',
  VERDICT: 'learn',
  OUTCOME: 'learn',
  HYPOTHESIS_VERDICT: 'learn',
  STAKEHOLDER_IMPACT: 'learn',
  SENTIMENT: 'learn',
  IMPACT_ASSESSMENT: 'learn',
  LESSON: 'learn',
  PLAYBOOK_UPDATE: 'learn',
  LEARNING: 'learn',
  CALIBRATION: 'learn',
  CALIBRATION_RECORD: 'learn',
  DRIFT_ALERT: 'learn',
}

const STAGE_TO_PHASE: Record<string, string> = {
  SIGNALS: 'listen',
  CLUSTER: 'listen',
  LISTEN: 'listen',
  INTAKE: 'decide',
  QUALIFY: 'decide',
  PACKET: 'decide',
  PORTFOLIO_GATE: 'decide',
  DEFINE: 'define',
  BUILD: 'build',
  CONSOLIDATE: 'ship',
  RELEASE_GATE: 'ship',
  ROLLOUT: 'ship',
  OBSERVE: 'ship',
  LEARN: 'learn',
  DONE: 'learn',
}

const PHASE_ORDER = ['listen', 'decide', 'define', 'build', 'ship', 'learn'] as const

type SimNode = { id: number; kind: string; x?: number; y?: number; featureId?: number | null }

function computeForceLayout(nodes: SimNode[], links: { source: number; target: number }[]) {
  const simNodes = nodes.map((n) => ({ ...n }))
  const index = new Map(simNodes.map((n, i) => [n.id, i]))
  const simLinks = links
    .map((l) => ({ source: index.get(l.source) ?? -1, target: index.get(l.target) ?? -1 }))
    .filter((l) => l.source >= 0 && l.target >= 0)
  const linkPairs = simLinks.map((l) => ({ source: l.source, target: l.target }))

  const sim = forceSimulation(simNodes)
    .force('link', forceLink(simLinks).distance(28).strength(0.45))
    .force('charge', forceManyBody().strength(-42))
    .force('center', forceCenter(0, 0))
    .force('x', forceX(0).strength(0.04))
    .force('y', forceY(0).strength(0.04))
    .stop()

  for (let i = 0; i < 180; i++) sim.tick()

  let max = 0.001
  for (const n of simNodes) {
    max = Math.max(max, Math.abs(n.x ?? 0), Math.abs(n.y ?? 0))
  }
  return {
    nodes: simNodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      featureId: n.featureId ?? null,
      x: (n.x ?? 0) / max,
      y: (n.y ?? 0) / max,
    })),
    links: linkPairs,
  }
}

function phaseIndex(phase: string) {
  const i = PHASE_ORDER.indexOf(phase as (typeof PHASE_ORDER)[number])
  return i < 0 ? 0 : i
}

function formatDwell(ms: number | null) {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return undefined
  const hours = ms / 3_600_000
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))}m`
  if (hours < 48) return `${hours.toFixed(1)}h`
  return `${(hours / 24).toFixed(1)}d`
}

export async function registerOfficeRoutes(
  app: FastifyInstance,
  deps: { bus: ContextBus },
): Promise<void> {
  app.get('/studio/office/roster', async () => ({
    agents: MANIFESTS.map((m) => ({
      id: m.id,
      name: m.name,
      archetype: m.archetype,
      domain: m.domain,
      dept: DOMAIN_TO_DEPT[m.domain] ?? 'cor',
      lead: LEAD_IDS.has(m.id),
      requiresGate: m.capabilities.requiresGate,
      maxWritesPerMinute: m.capabilities.maxWritesPerMinute,
    })),
  }))

  app.get('/studio/office/graph', async () => {
    const nodes = await query<{
      id: number
      kind: string
      created_at: Date
      metadata: Record<string, unknown> | null
    }>(
      `SELECT id, kind, created_at, metadata FROM graph_nodes
       ORDER BY created_at DESC LIMIT 400`,
    )
    const ids = nodes.map((n) => n.id)
    const edges =
      ids.length === 0
        ? []
        : await query<{ from_node_id: number; to_node_id: number; kind: string }>(
            `SELECT from_node_id, to_node_id, kind FROM graph_edges
             WHERE from_node_id = ANY($1) OR to_node_id = ANY($1)`,
            [ids],
          )

    const featureByNode = new Map<number, number>()
    for (const n of nodes) {
      const metaFid = Number(n.metadata?.featureId ?? n.metadata?.feature_id)
      if (n.kind === 'FEATURE') featureByNode.set(n.id, n.id)
      else if (Number.isFinite(metaFid) && metaFid > 0) featureByNode.set(n.id, metaFid)
    }
    for (const e of edges) {
      const a = nodes.find((n) => n.id === e.from_node_id)
      const b = nodes.find((n) => n.id === e.to_node_id)
      if (a?.kind === 'FEATURE') featureByNode.set(e.to_node_id, a.id)
      if (b?.kind === 'FEATURE') featureByNode.set(e.from_node_id, b.id)
    }

    const layout = computeForceLayout(
      nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        featureId: featureByNode.get(n.id) ?? null,
      })),
      edges.map((e) => ({ source: e.from_node_id, target: e.to_node_id })),
    )

    return {
      notes: nodes.length,
      nodes: layout.nodes,
      links: layout.links,
    }
  })

  app.get('/studio/office/state', async () => {
    const cycles = await query<{
      id: string
      label: string
      status: string
      current_stage: string
      feature_id: number | null
      feature_name: string | null
      created_at: Date
      updated_at: Date
    }>(`
      SELECT c.id, c.label, c.status, c.current_stage, c.feature_id,
             n.label as feature_name, c.created_at, c.updated_at
      FROM cycles c
      LEFT JOIN graph_nodes n ON n.id = c.feature_id
      WHERE c.status = 'active' AND c.current_stage <> 'DONE'
      ORDER BY c.updated_at DESC
    `)

    const featuresOnly = await query<{ id: number; label: string }>(`
      SELECT id, label FROM graph_nodes WHERE kind='FEATURE'
    `)

    const episodes = await query<{
      agent_id: string
      feature_id: number | null
      domain: string
      ts: Date
      connector: string | null
    }>(`
      SELECT agent_id, feature_id, domain, ts, NULL::text as connector
      FROM agent_episodes
      WHERE ts > NOW() - INTERVAL '3 minutes'
    `)

    const writes = await query<{ agent_id: string; writes: string }>(`
      SELECT agent_id, COUNT(*)::text as writes
      FROM audit_log
      WHERE ts > NOW() - INTERVAL '1 minute'
      GROUP BY agent_id
    `).catch(() => [] as { agent_id: string; writes: string }[])
    const writeMap = new Map(writes.map((w) => [w.agent_id, parseInt(w.writes, 10)]))

    const artifacts = await query<{
      feature_id: number
      kind: string
      created_at: Date
    }>(`
      SELECT DISTINCT COALESCE(
        NULLIF((n.metadata->>'featureId')::int, 0),
        NULLIF((n.metadata->>'feature_id')::int, 0),
        CASE WHEN n.kind='FEATURE' THEN n.id END,
        fe.id
      ) as feature_id, n.kind, n.created_at
      FROM graph_nodes n
      LEFT JOIN graph_edges e ON e.from_node_id = n.id OR e.to_node_id = n.id
      LEFT JOIN graph_nodes fe ON (fe.id = e.from_node_id OR fe.id = e.to_node_id) AND fe.kind='FEATURE'
      WHERE COALESCE(
        NULLIF((n.metadata->>'featureId')::int, 0),
        NULLIF((n.metadata->>'feature_id')::int, 0),
        CASE WHEN n.kind='FEATURE' THEN n.id END,
        fe.id
      ) IS NOT NULL
    `).catch(() => [] as { feature_id: number; kind: string; created_at: Date }[])

    const decisions = await query<{ feature_id: number | null; gate: string; decision: string }>(`
      SELECT NULLIF((metadata->>'featureId')::int, 0) as feature_id,
             COALESCE(metadata->>'gate', '') as gate,
             COALESCE(metadata->>'decision', '') as decision
      FROM graph_nodes
      WHERE kind='DECISION_RECORD'
    `)

    const dwellRows = await query<{
      feature_id: number
      domain: string
      first_ts: Date
      last_ts: Date
    }>(`
      SELECT feature_id, domain, MIN(ts) as first_ts, MAX(ts) as last_ts
      FROM agent_episodes
      WHERE feature_id IS NOT NULL
      GROUP BY feature_id, domain
    `).catch(() => [] as { feature_id: number; domain: string; first_ts: Date; last_ts: Date }[])

    const cycleByFeature = new Map(cycles.map((c) => [c.feature_id, c]))
    const seen = new Set<number>()
    const features = []

    for (const c of cycles) {
      const fid = c.feature_id
      if (!fid || seen.has(fid)) continue
      seen.add(fid)
      features.push(
        mapFeature({
          id: fid,
          name: c.feature_name ?? c.label,
          stage: c.current_stage,
          closed: false,
          artifacts: artifacts.filter((a) => a.feature_id === fid),
          decisions: decisions.filter((d) => d.feature_id === fid),
          episodes: episodes.filter((e) => e.feature_id === fid),
          dwell: dwellRows.filter((d) => d.feature_id === fid),
        }),
      )
    }

    for (const f of featuresOnly) {
      if (seen.has(f.id)) continue
      const c = cycleByFeature.get(f.id)
      if (c && (c.status !== 'active' || c.current_stage === 'DONE')) continue
      if (!c) {
        const hasArt = artifacts.some((a) => a.feature_id === f.id)
        if (!hasArt) continue
      }
      seen.add(f.id)
      features.push(
        mapFeature({
          id: f.id,
          name: f.label,
          stage: c?.current_stage ?? 'INTAKE',
          closed: false,
          artifacts: artifacts.filter((a) => a.feature_id === f.id),
          decisions: decisions.filter((d) => d.feature_id === f.id),
          episodes: episodes.filter((e) => e.feature_id === f.id),
          dwell: dwellRows.filter((d) => d.feature_id === f.id),
        }),
      )
    }

    return {
      features,
      busyAgents: episodes.map((e) => ({
        agentId: e.agent_id,
        featureId: e.feature_id,
        domain: e.domain,
        connector: e.connector,
        writesLastMin: writeMap.get(e.agent_id) ?? 0,
      })),
    }
  })

  app.get('/studio/office/stream', async (req, reply) => {
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })
    reply.raw.write(':ok\n\n')
    const unsub = deps.bus.subscribe('context.>', 'office-sse', async (event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    })
    req.raw.on('close', () => {
      unsub()
    })
  })
}

function mapFeature(input: {
  id: number
  name: string
  stage: string
  closed: boolean
  artifacts: { kind: string; created_at: Date }[]
  decisions: { gate: string; decision: string }[]
  episodes: { domain: string; ts: Date }[]
  dwell: { domain: string; first_ts: Date; last_ts: Date }[]
}) {
  let phase = STAGE_TO_PHASE[input.stage] ?? 'decide'
  const kinds = new Set(input.artifacts.map((a) => a.kind))
  const admitted = input.decisions.some(
    (d) => d.gate === 'PORTFOLIO_GATE' && d.decision === 'admit',
  )
  if (input.stage === 'BUILD' && !kinds.has('REQUIREMENT') && !kinds.has('USER_STORY') && admitted) {
    phase = 'define'
  }

  const completed = new Set<string>()
  for (const a of input.artifacts) {
    const p = KIND_TO_PHASE[a.kind]
    if (p) completed.add(p)
  }
  const cur = phaseIndex(phase)
  for (let i = 0; i < cur; i++) completed.add(PHASE_ORDER[i])
  if (phase === 'define' && admitted) completed.add('decide')

  const waitingPortfolio = input.stage === 'PORTFOLIO_GATE' && !admitted
  const waitingRelease =
    input.stage === 'RELEASE_GATE' &&
    !input.decisions.some((d) => d.gate === 'RELEASE_GATE')
  const waiting = waitingPortfolio || waitingRelease
  const doing = input.episodes.length > 0 && !waiting

  let state: 'doing' | 'waiting' | 'next' | 'done' | 'sched' = 'next'
  if (input.closed) state = 'done'
  else if (waiting) state = 'waiting'
  else if (doing) state = 'doing'
  else state = 'next'

  const dwell: Record<string, string> = {}
  for (const d of input.dwell) {
    const p = d.domain
    dwell[p] = formatDwell(new Date(d.last_ts).getTime() - new Date(d.first_ts).getTime()) ?? ''
  }

  const journey = PHASE_ORDER.filter((p) => completed.has(p) || p === phase)

  return {
    id: input.id,
    name: input.name,
    phase,
    currentStage: input.stage,
    state,
    completedPhases: [...completed],
    journey,
    dwell,
    gateKind: waitingPortfolio ? 'PORTFOLIO_GATE' : waitingRelease ? 'RELEASE_GATE' : null,
    gateHref: waitingPortfolio ? '/portfolio' : waitingRelease ? '/release' : null,
  }
}
