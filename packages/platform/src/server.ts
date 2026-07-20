import 'dotenv/config'
import { initTelemetry, shutdown, withSpan, createPlatformMetrics } from './telemetry/index.js'

initTelemetry()
const platformMetrics = createPlatformMetrics()

import Fastify from 'fastify'
import cors from '@fastify/cors'
import { v4 as uuid } from 'uuid'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { initPool, migrate, query, queryOne } from './db/pool.js'
import { initRedis } from './memory/redisMemory.js'
import { PostgresEpisodicMemory } from './memory/episodicMemory.js'
import { ContextBus } from './bus/contextBus.js'
import { JwtService } from './auth/jwtService.js'
import { createLLMGateway } from './llm/llmGateway.js'
import { CycleOrchestrator } from './orchestrator/cycleOrchestrator.js'
import { registerStudioRoutes } from './studio/studioRoutes.js'
import type { AgentManifest, AgentJwtPayload } from '@avp/shared'

declare module 'fastify' {
  interface FastifyRequest {
    agent?: AgentJwtPayload
  }
}

const app = Fastify({
  logger: {
    transport: { target: 'pino-pretty', options: { colorize: true } },
  },
})
const bus = new ContextBus()
const jwt = new JwtService()
const llm = createLLMGateway()
const PORT = parseInt(process.env.PORT ?? '7070', 10)

const writeCounters = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(agentId: string, maxPerMin: number): boolean {
  const now = Date.now()
  const entry = writeCounters.get(agentId) ?? { count: 0, resetAt: now + 60_000 }
  if (now > entry.resetAt) {
    entry.count = 0
    entry.resetAt = now + 60_000
  }
  entry.count++
  writeCounters.set(agentId, entry)
  return entry.count <= maxPerMin
}

function requestPath(url: string): string {
  const q = url.indexOf('?')
  return q === -1 ? url : url.slice(0, q)
}

async function start(): Promise<void> {
  await initPool()
  await migrate()
  await initRedis()
  await bus.connect()

  const keyDir = process.env.KEY_DIR ?? join(homedir(), '.avp', 'keys')
  await jwt.init(keyDir)

  await app.register(cors, { origin: '*' })

  const PUBLIC = new Set(['/health', '/agents/register', '/studio/public/settings'])
  const STUDIO_SECRET = process.env.STUDIO_SECRET ?? 'avp-studio-dev-secret'
  const STUDIO_PREFIXES = [
    '/studio/',
    '/ingest/',
    '/connectors',
    '/settings',
    '/team/',
    '/sso/',
  ]

  app.addHook('preHandler', async (req, reply) => {
    const path = requestPath(req.url)
    if (PUBLIC.has(path)) return

    const studioSecret = req.headers['x-studio-secret']
    if (
      typeof studioSecret === 'string' &&
      studioSecret === STUDIO_SECRET &&
      STUDIO_PREFIXES.some((p) => path === p || path.startsWith(p))
    ) {
      return
    }

    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing Authorization header' })
    }
    try {
      req.agent = await jwt.verify(auth.slice(7))
    } catch {
      return reply.status(401).send({ error: 'Invalid or expired token' })
    }
  })

  app.get('/health', async () => ({
    status: 'ok',
    ts: Date.now(),
    llm: await llm.isAvailable(),
    db: true,
    redis: true,
    nats: bus.isConnected(),
  }))

  app.post<{ Body: AgentManifest }>('/agents/register', async (req) => {
    const manifest = req.body
    await query(
      `
      INSERT INTO agent_registry (id, name, archetype, domain, runtime, version, manifest)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id) DO UPDATE SET
        name=$2, archetype=$3, domain=$4, runtime=$5, version=$6,
        manifest=$7, last_seen_at=NOW(), status='active'
    `,
      [
        manifest.id,
        manifest.name,
        manifest.archetype,
        manifest.domain,
        manifest.runtime,
        manifest.version,
        JSON.stringify(manifest),
      ],
    )
    platformMetrics.agentRegistrations.add(1, { agentId: manifest.id })
    const token = await jwt.issue(manifest)
    return { token, agentId: manifest.id, expiresIn: '30d' }
  })

  const orchestrator = new CycleOrchestrator(bus)

  app.post<{ Body: Record<string, unknown> }>('/graph/nodes', async (req, reply) => {
    const agent = req.agent!
    const { kind, label, description, metadata, traceId: incoming } = req.body as {
      kind: string
      label: string
      description?: string
      metadata?: Record<string, unknown>
      traceId?: string
    }

    return withSpan(
      'platform.graphWrite.node',
      { 'agent.id': agent.sub, 'node.kind': kind },
      async () => {
        if (!agent.nodeKinds.includes(kind)) {
          platformMetrics.graphWriteErrors.add(1, { agentId: agent.sub, reason: 'capability' })
          return reply.status(403).send({
            error: `${agent.sub} may not write ${kind} nodes`,
            allowed: agent.nodeKinds,
          })
        }

        if (!checkRateLimit(agent.sub, agent.maxWritesPerMinute)) {
          platformMetrics.graphWriteErrors.add(1, { agentId: agent.sub, reason: 'rate' })
          return reply.status(429).send({ error: 'Rate limit exceeded' })
        }

        const traceId = incoming ?? uuid()
        const node = await queryOne<{ id: number }>(
          `
      INSERT INTO graph_nodes (kind, label, description, metadata, written_by_agent, trace_id)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (workspace_id, kind, label) DO UPDATE SET
        description = EXCLUDED.description,
        metadata = EXCLUDED.metadata,
        written_by_agent = EXCLUDED.written_by_agent,
        trace_id = EXCLUDED.trace_id,
        updated_at = NOW()
      RETURNING id
    `,
          [kind, label, description ?? null, JSON.stringify(metadata ?? {}), agent.sub, traceId],
        )

        await query(
          `INSERT INTO audit_log (agent_id,runtime,operation,node_id,trace_id,jwt_claims)
       VALUES ($1,$2,$3,$4,$5,$6)`,
          [agent.sub, agent.runtime, 'upsertNode', node!.id, traceId, JSON.stringify(agent)],
        )

        platformMetrics.graphWritesTotal.add(1, { agentId: agent.sub, kind })

        await bus.publish({
          id: uuid(),
          traceId,
          spanId: uuid(),
          agentId: agent.sub,
          runtime: agent.runtime,
          domain: agent.domain,
          kind: 'node_written',
          graphDelta: { nodesCreated: [node!.id], edgesCreated: [] },
          ts: Date.now(),
          metadata: { nodeKind: kind, label },
        })

        return { nodeId: node!.id, traceId, agentId: agent.sub, ts: Date.now() }
      },
    )
  })

  app.post<{ Body: Record<string, unknown> }>('/graph/edges', async (req, reply) => {
    const agent = req.agent!
    const {
      fromId,
      toId,
      kind,
      weight = 1.0,
      metadata,
      traceId: incoming,
    } = req.body as {
      fromId: number
      toId: number
      kind: string
      weight?: number
      metadata?: Record<string, unknown>
      traceId?: string
    }

    if (!agent.edgeKinds.includes(kind)) {
      platformMetrics.graphWriteErrors.add(1, { agentId: agent.sub, reason: 'capability' })
      return reply.status(403).send({
        error: `${agent.sub} may not write ${kind} edges`,
        allowed: agent.edgeKinds,
      })
    }

    if (!checkRateLimit(agent.sub, agent.maxWritesPerMinute)) {
      return reply.status(429).send({ error: 'Rate limit exceeded' })
    }

    const traceId = incoming ?? uuid()
    const edge = await queryOne<{ id: number }>(
      `
      INSERT INTO graph_edges (from_node_id, to_node_id, kind, weight, metadata)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (from_node_id, to_node_id, kind) DO UPDATE SET
        weight = EXCLUDED.weight,
        metadata = EXCLUDED.metadata
      RETURNING id
    `,
      [fromId, toId, kind, weight, JSON.stringify(metadata ?? {})],
    )

    await query(
      `INSERT INTO audit_log (agent_id,runtime,operation,edge_id,trace_id,jwt_claims)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [agent.sub, agent.runtime, 'insertEdge', edge!.id, traceId, JSON.stringify(agent)],
    )

    await bus.publish({
      id: uuid(),
      traceId,
      spanId: uuid(),
      agentId: agent.sub,
      runtime: agent.runtime,
      domain: agent.domain,
      kind: 'edge_written',
      graphDelta: { nodesCreated: [], edgesCreated: [edge!.id] },
      ts: Date.now(),
    })

    return { edgeId: edge!.id, traceId, agentId: agent.sub, ts: Date.now() }
  })

  app.post<{ Body: { sql: string; params?: unknown[] } }>('/graph/query', async (req, reply) => {
    const { sql, params = [] } = req.body
    if (!sql.trim().toLowerCase().startsWith('select')) {
      return reply.status(400).send({ error: 'Only SELECT queries allowed' })
    }
    return query(sql, params)
  })

  const episodic = new PostgresEpisodicMemory()

  app.post<{ Body: Record<string, unknown> }>('/episodes', async (req) => {
    const agent = req.agent!
    const id = await episodic.write({
      ...(req.body as object),
      agentId: agent.sub,
    } as Parameters<typeof episodic.write>[0])
    return { id }
  })

  app.get<{ Querystring: { agentId: string; hash: string; limit?: string } }>(
    '/episodes/similar',
    async (req) => {
      return episodic.readSimilar(
        req.query.agentId,
        req.query.hash,
        parseInt(req.query.limit ?? '5', 10),
      )
    },
  )

  app.patch<{ Params: { id: string }; Body: { outcomeNodeId: number } }>(
    '/episodes/:id/outcome',
    async (req) => {
      await episodic.linkOutcome(parseInt(req.params.id, 10), req.body.outcomeNodeId)
      return { updated: true }
    },
  )

  app.post<{ Body: Record<string, unknown> }>('/llm/complete', async (req) => {
    const agent = req.agent!
    const budget = (req.body.maxTokens as number | undefined) ?? 4096
    return withSpan('platform.llm.complete', { 'agent.id': agent.sub }, async () => {
      const result = await llm.complete({
        ...(req.body as object),
        agentId: agent.sub,
        maxTokens: budget,
      } as Parameters<typeof llm.complete>[0])
      const tokens = (result.tokensUsed?.input ?? 0) + (result.tokensUsed?.output ?? 0)
      if (tokens > 0) {
        platformMetrics.llmTokensUsed.record(tokens, { agentId: agent.sub })
      }
      return result
    })
  })

  app.post<{ Body: { label: string; workspaceId?: string } }>('/cycles', async (req) => {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO cycles (label, workspace_id, current_stage) VALUES ($1,$2,'SIGNALS') RETURNING id`,
      [req.body.label, req.body.workspaceId ?? 'default'],
    )
    platformMetrics.cyclesStarted.add(1)
    return row
  })

  app.get<{ Params: { id: string } }>('/cycles/:id', async (req) => {
    return queryOne(`SELECT * FROM cycles WHERE id=$1`, [req.params.id])
  })

  app.patch<{
    Params: { id: string }
    Body: {
      current_stage?: string
      feature_id?: number | null
      status?: string
      metadata?: Record<string, unknown>
      label?: string
    }
  }>('/cycles/:id', async (req, reply) => {
    const existing = await queryOne<{ id: string }>(`SELECT id FROM cycles WHERE id=$1`, [
      req.params.id,
    ])
    if (!existing) return reply.status(404).send({ error: 'cycle not found' })

    const b = req.body
    await query(
      `UPDATE cycles SET
         current_stage = COALESCE($2, current_stage),
         feature_id = COALESCE($3, feature_id),
         status = COALESCE($4, status),
         metadata = CASE WHEN $5::jsonb IS NULL THEN metadata ELSE metadata || $5::jsonb END,
         label = COALESCE($6, label),
         updated_at = NOW()
       WHERE id = $1`,
      [
        req.params.id,
        b.current_stage ?? null,
        b.feature_id === undefined ? null : b.feature_id,
        b.status ?? null,
        b.metadata ? JSON.stringify(b.metadata) : null,
        b.label ?? null,
      ],
    )
    return queryOne(`SELECT * FROM cycles WHERE id=$1`, [req.params.id])
  })

  app.post<{
    Body: {
      agentId?: string
      cycleId: string
      predictedValue: number
      actualValue: number
      errorPct?: number
      kpi: string
    }
  }>('/calibration', async (req, reply) => {
    const agent = req.agent!
    const b = req.body
    if (!b.cycleId || b.predictedValue === undefined || b.actualValue === undefined || !b.kpi) {
      return reply.status(400).send({ error: 'cycleId, predictedValue, actualValue, kpi required' })
    }
    const predicted = Number(b.predictedValue)
    const actual = Number(b.actualValue)
    const errorPct =
      b.errorPct ??
      (Math.abs(predicted - actual) / Math.max(Math.abs(actual), 1e-9)) * 100

    const row = await queryOne<{ id: string }>(
      `INSERT INTO agent_calibration (agent_id, cycle_id, predicted_value, actual_value, error_pct, kpi)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [b.agentId ?? agent.sub, b.cycleId, predicted, actual, errorPct, b.kpi],
    )
    return { id: row!.id, errorPct }
  })

  app.post<{ Body: Record<string, unknown> }>('/events', async (req, reply) => {
    const agent = req.agent!
    const body = req.body as {
      id?: string
      traceId: string
      spanId: string
      kind: string
      graphDelta?: { nodesCreated?: number[]; edgesCreated?: number[] }
      metadata?: Record<string, unknown>
      cycleId?: string
      featureId?: number
      runtime?: string
      domain?: string
      ts?: number
    }

    if (!body.traceId || !body.spanId || !body.kind) {
      return reply.status(400).send({ error: 'traceId, spanId, and kind are required' })
    }

    const event = {
      id: body.id ?? uuid(),
      traceId: body.traceId,
      spanId: body.spanId,
      agentId: agent.sub,
      runtime: agent.runtime,
      domain: agent.domain,
      kind: body.kind,
      graphDelta: {
        nodesCreated: body.graphDelta?.nodesCreated ?? [],
        edgesCreated: body.graphDelta?.edgesCreated ?? [],
      },
      metadata: body.metadata,
      cycleId: body.cycleId,
      featureId: body.featureId,
      ts: body.ts ?? Date.now(),
    }

    await bus.publish(event)

    if (body.cycleId) {
      void orchestrator.advance(body.cycleId).catch(console.error)
    }

    return { published: true, subject: `context.${event.domain}.${event.kind}`, id: event.id }
  })

  app.post<{
    Params: { id: string }
    Body: { gate: string; decision: string; role: string; rationale: string }
  }>('/cycles/:id/gate', async (req) => {
    const { gate, decision, role, rationale } = req.body
    const nodeId = await orchestrator.recordGate(
      req.params.id,
      gate,
      decision,
      role,
      rationale ?? '',
    )
    return { nodeId, recorded: true }
  })

  app.post<{ Params: { id: string } }>('/cycles/:id/advance', async (req) => {
    await orchestrator.advance(req.params.id)
    return { advanced: true }
  })

  bus.subscribe('context.>', 'orchestrator-advance', async (event) => {
    if (event.cycleId) {
      await orchestrator.advance(event.cycleId).catch(console.error)
    }
  })

  setInterval(() => {
    void orchestrator.tick()
  }, 30_000)

  const platformUrl = process.env.AVP_PLATFORM_URL ?? `http://127.0.0.1:${PORT}`
  await registerStudioRoutes(app, { llm, platformUrl, orchestrator })

  process.on('SIGTERM', async () => {
    await shutdown()
    process.exit(0)
  })

  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`[Platform API] http://0.0.0.0:${PORT}`)
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})
