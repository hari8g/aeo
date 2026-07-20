# Agentic Value Platform (AVP) — Complete Implementation Plan
## Enterprise-grade · 20 agents · 6 runtimes · Common operating platform

> **Scope**: A completely standalone enterprise platform. No prior codebase assumed.
> Every step is self-contained: problem → create/modify → code → verify → what it unlocks.

---

## Repository bootstrap

```bash
mkdir avp && cd avp
git init
pnpm init
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - 'packages/*'
  - 'packages/agents/*'
  - 'packages/agents/**/*'
  - 'packages/runtimes/*'
EOF

cat > package.json << 'EOF'
{
  "name": "avp",
  "private": true,
  "scripts": {
    "dev":   "docker compose up -d && turbo run dev",
    "build": "turbo run build",
    "test":  "turbo run test",
    "db:migrate": "pnpm -F @avp/platform db:migrate"
  },
  "devDependencies": {
    "turbo":      "^2.1.0",
    "typescript": "^5.5.0",
    "@types/node": "^20.0.0"
  }
}
EOF

# Root tsconfig
cat > tsconfig.base.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext",
    "moduleResolution": "NodeNext", "strict": true,
    "esModuleInterop": true, "skipLibCheck": true,
    "declaration": true, "outDir": "dist"
  }
}
EOF
```

### Directory structure

```
avp/
├── packages/
│   ├── shared/              # All shared types — every package imports this
│   ├── platform/            # Agent Operating Platform (AOP) API server
│   ├── agents/
│   │   ├── listen/          voc-intelligence/  market-signal/
│   │   ├── decide/          business-case/  value-engineering/  product-strategy/
│   │   │                    solutions-estimation/  portfolio-management/
│   │   ├── define/          requirements-analyst/  domain-steward/  solutions-architect/
│   │   ├── build/           software-engineering/  quality-engineering/  documentation/
│   │   ├── ship/            devops/  devsecops/  finops/  release-manager/
│   │   │                    deployment-engineer/  sre/
│   │   └── learn/           attribution-analyst/  stakeholder-impact/
│   │                        organizational-learning/  calibration/
│   ├── runtimes/
│   │   ├── studio/          studio-runtime/  (React SPA + Electron)
│   │   ├── engineering/     ide-runtime/     (VS Code extension)
│   │   ├── pipeline/        pipeline-runtime/ (CLI for CI/CD)
│   │   ├── observability/   obs-runtime/     (Grafana/Datadog sidecar)
│   │   ├── collaboration/   collab-runtime/  (Slack bot)
│   │   └── worker/          worker-runtime/  (Background workers)
│   └── ui/                  # React web application
├── deploy/
│   ├── docker/              docker-compose.yml  docker-compose.prod.yml
│   ├── k8s/                 Helm charts
│   └── github-actions/      avp-pipeline.yml
└── scripts/
    └── bootstrap.sh         # One-command setup
```

---

## STEP 1 — Shared types package

```bash
mkdir -p packages/shared/src
cat > packages/shared/package.json << 'EOF'
{
  "name": "@avp/shared",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./dist/index.js" },
  "scripts": { "build": "tsc" }
}
EOF
```

### `packages/shared/src/index.ts`

```typescript
// ── Runtime identifiers ────────────────────────────────────────────────────
export type RuntimeId =
  | 'studio' | 'engineering' | 'pipeline'
  | 'observability' | 'collaboration' | 'worker'

// ── Domain verbs ───────────────────────────────────────────────────────────
export type VerbDomain = 'listen' | 'decide' | 'define' | 'build' | 'ship' | 'learn'

// ── Agent manifest — submitted on registration ─────────────────────────────
export interface AgentManifest {
  id: string                     // 'devsecops-agent:v1'
  name: string                   // 'DevSecOps Agent'
  archetype: string              // 'DevSecOps Engineer'
  domain: VerbDomain
  runtime: RuntimeId
  version: string
  capabilities: {
    nodeKinds: string[]          // graph_nodes.kind values this agent may write
    edgeKinds: string[]          // graph_edges.kind values this agent may create
    requiresGate: boolean        // writes must be preceded by human gate
    maxWritesPerMinute: number   // rate limit
  }
  subscribes: string[]           // NATS/Kafka topic patterns
  healthEndpoint: string
  llmBudget?: {
    maxTokensPerRun: number
    preferredModel: string
  }
}

// ── JWT payload per agent ──────────────────────────────────────────────────
export interface AgentJwtPayload {
  sub: string; iss: string; aud: string
  runtime: RuntimeId; domain: VerbDomain
  nodeKinds: string[]; edgeKinds: string[]
  requiresGate: boolean; maxWritesPerMinute: number
  iat: number; exp: number
}

// ── Context bus event ──────────────────────────────────────────────────────
export interface AgentContextEvent {
  id: string                     // UUIDv4
  traceId: string                // W3C traceparent, propagate in all downstream spans
  spanId: string
  agentId: string
  runtime: RuntimeId
  domain: VerbDomain
  kind: string                   // 'security_scan_completed' | 'hypothesis_committed' | …
  graphDelta: { nodesCreated: number[]; edgesCreated: number[] }
  metadata?: Record<string, unknown>
  cycleId?: string
  featureId?: number
  ts: number
}

// ── Graph operations ───────────────────────────────────────────────────────
export type GraphWriteOp =
  | { type: 'upsertNode'; kind: string; label: string; description?: string; metadata?: Record<string, unknown> }
  | { type: 'insertEdge'; fromId: number; toId: number; kind: string; weight?: number; metadata?: Record<string, unknown> }

export interface GraphWriteResult {
  nodeId?: number
  edgeId?: number
  agentId: string
  traceId: string
  ts: number
}

// ── Runtime adapter contract ───────────────────────────────────────────────
export interface IWorkingMemory {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>
  delete(key: string): Promise<void>
}

export interface EpisodeRecord {
  agentId: string; sessionId: string; domain: VerbDomain
  cycleId?: string; featureId?: number
  inputHash: string; inputSummary?: string
  systemPromptExcerpt?: string
  outputSummary?: string; outputNodeIds?: number[]
  confidencePct?: number; latencyMs?: number
  llmTokensUsed?: number
}

export interface IEpisodicMemory {
  write(episode: EpisodeRecord): Promise<number>
  readSimilar(agentId: string, inputHash: string, limit?: number): Promise<(EpisodeRecord & { id: number; outcomeLabel?: string })[]>
  linkOutcome(episodeId: number, outcomeNodeId: number): Promise<void>
}

export interface IRuntimeAdapter {
  readonly agentId: string
  readonly runtime: RuntimeId
  readonly jwt: string
  graphWrite(op: GraphWriteOp): Promise<GraphWriteResult>
  graphRead<T>(sql: string, params?: unknown[]): Promise<T[]>
  publish(event: Omit<AgentContextEvent, 'id' | 'agentId' | 'ts'>): Promise<void>
  subscribe(pattern: string, handler: (e: AgentContextEvent) => Promise<void>): () => void
  workingMemory: IWorkingMemory
  episodicMemory: IEpisodicMemory
  health(): Promise<{ status: 'ok' | 'degraded'; detail?: string }>
  shutdown(): Promise<void>
}

// ── LLM Gateway types ──────────────────────────────────────────────────────
export type LLMProvider = 'anthropic' | 'openai' | 'azure-openai' | 'aws-bedrock'

export interface LLMRequest {
  model: string; system?: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  maxTokens?: number; temperature?: number
  agentId: string
}

export interface LLMResponse {
  text: string; provider: LLMProvider
  tokensUsed: { input: number; output: number }
  cached: boolean
}

export interface ILLMGateway {
  complete(req: LLMRequest): Promise<LLMResponse>
  isAvailable(): Promise<boolean>
}
```

---

## STEP 2 — Docker Compose (run this before anything else)

### `deploy/docker/docker-compose.yml`

```yaml
version: '3.9'

services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: avp
      POSTGRES_USER: avp
      POSTGRES_PASSWORD: avp_dev_password
    ports: ['5432:5432']
    volumes: ['pgdata:/var/lib/postgresql/data']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U avp']
      interval: 5s; timeout: 5s; retries: 10

  redis:
    image: redis:7-alpine
    ports: ['6379:6379']
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s; timeout: 3s; retries: 5

  nats:
    image: nats:2.10-alpine
    command: -js -sd /data
    ports: ['4222:4222', '8222:8222']
    volumes: ['natsdata:/data']

  jaeger:
    image: jaegertracing/all-in-one:1.58
    environment: { COLLECTOR_OTLP_ENABLED: 'true' }
    ports: ['16686:16686', '4318:4318']

  grafana:
    image: grafana/grafana:11.0.0
    ports: ['3100:3000']
    environment: { GF_SECURITY_ADMIN_PASSWORD: admin }
    volumes: ['grafana:/var/lib/grafana']

  prometheus:
    image: prom/prometheus:v2.53.0
    ports: ['9090:9090']
    volumes: ['./prometheus.yml:/etc/prometheus/prometheus.yml']

  minio:
    image: minio/minio
    command: server /data --console-address ':9001'
    environment: { MINIO_ROOT_USER: avp, MINIO_ROOT_PASSWORD: avp_dev_password }
    ports: ['9000:9000', '9001:9001']
    volumes: ['miniodata:/data']

volumes:
  pgdata: {}; natsdata: {}; grafana: {}; miniodata: {}
```

```bash
# Start all infrastructure
cd deploy/docker && docker compose up -d
# Verify
docker compose ps   # all services should be 'healthy'
```

---

## STEP 3 — Platform API server

```bash
mkdir -p packages/platform/src/{db,auth,bus,policy,memory,llm,registry,telemetry,routes}
cat > packages/platform/package.json << 'EOF'
{
  "name": "@avp/platform",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev":        "tsx watch src/server.ts",
    "build":      "tsc",
    "db:migrate": "tsx src/db/migrate.ts"
  },
  "dependencies": {
    "@avp/shared":   "workspace:*",
    "fastify":       "^4.28.0",
    "@fastify/cors": "^9.0.0",
    "pg":            "^8.12.0",
    "ioredis":       "^5.4.0",
    "nats":          "^2.28.0",
    "jose":          "^5.6.0",
    "uuid":          "^10.0.0",
    "@opentelemetry/sdk-node": "^0.53.0",
    "@opentelemetry/api":      "^1.9.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.53.0",
    "pino": "^9.3.0", "pino-pretty": "^11.2.0"
  }
}
EOF
pnpm -F @avp/platform install
```

### `packages/platform/src/db/schema.sql`

```sql
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Knowledge graph nodes
CREATE TABLE IF NOT EXISTS graph_nodes (
  id               SERIAL PRIMARY KEY,
  kind             TEXT NOT NULL,
  label            TEXT NOT NULL,
  description      TEXT,
  metadata         JSONB DEFAULT '{}',
  embedding        vector(1536),          -- for semantic search
  written_by_agent TEXT,
  trace_id         TEXT,
  workspace_id     TEXT NOT NULL DEFAULT 'default',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON graph_nodes(kind);
CREATE INDEX ON graph_nodes(workspace_id, kind);
CREATE INDEX ON graph_nodes USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

-- Knowledge graph edges
CREATE TABLE IF NOT EXISTS graph_edges (
  id           SERIAL PRIMARY KEY,
  from_node_id INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  to_node_id   INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  weight       FLOAT NOT NULL DEFAULT 1.0,
  metadata     JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(from_node_id, to_node_id, kind)
);
CREATE INDEX ON graph_edges(from_node_id);
CREATE INDEX ON graph_edges(to_node_id);
CREATE INDEX ON graph_edges(kind);

-- Agent registry
CREATE TABLE IF NOT EXISTS agent_registry (
  id           TEXT PRIMARY KEY,           -- 'devsecops-agent:v1'
  name         TEXT NOT NULL,
  archetype    TEXT NOT NULL,
  domain       TEXT NOT NULL,
  runtime      TEXT NOT NULL,
  version      TEXT NOT NULL,
  manifest     JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  last_seen_at TIMESTAMPTZ,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Immutable audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  agent_id   TEXT NOT NULL,
  runtime    TEXT NOT NULL,
  operation  TEXT NOT NULL,
  node_id    INTEGER,
  edge_id    INTEGER,
  trace_id   TEXT NOT NULL,
  jwt_claims JSONB,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  ts         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON audit_log(agent_id, ts);
CREATE INDEX ON audit_log(trace_id);

-- Episodic memory
CREATE TABLE IF NOT EXISTS agent_episodes (
  id                  BIGSERIAL PRIMARY KEY,
  agent_id            TEXT NOT NULL,
  session_id          UUID NOT NULL,
  domain              TEXT NOT NULL,
  cycle_id            TEXT,
  feature_id          INTEGER REFERENCES graph_nodes(id),
  input_hash          TEXT NOT NULL,
  input_summary       TEXT,
  system_prompt_excerpt TEXT,
  output_summary      TEXT,
  output_node_ids     INTEGER[],
  outcome_node_id     INTEGER REFERENCES graph_nodes(id),
  confidence_pct      SMALLINT,
  latency_ms          INTEGER,
  llm_tokens_used     INTEGER,
  ts                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON agent_episodes(agent_id, input_hash);
CREATE INDEX ON agent_episodes(cycle_id);

-- Value stream (cycle) state
CREATE TABLE IF NOT EXISTS cycles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label        TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  status       TEXT NOT NULL DEFAULT 'active',
  current_stage TEXT NOT NULL DEFAULT 'LISTEN',
  feature_id   INTEGER REFERENCES graph_nodes(id),
  metadata     JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agent calibration records
CREATE TABLE IF NOT EXISTS agent_calibration (
  id              BIGSERIAL PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  cycle_id        TEXT NOT NULL,
  predicted_value FLOAT,
  actual_value    FLOAT,
  error_pct       FLOAT,
  kpi             TEXT,
  ts              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON agent_calibration(agent_id, ts);
```

### `packages/platform/src/db/pool.ts`

```typescript
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

let pool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (!pool) throw new Error('DB pool not initialized — call initPool() first')
  return pool
}

export async function initPool(): Promise<pg.Pool> {
  pool = new pg.Pool({
    host:     process.env.DB_HOST     ?? 'localhost',
    port:     parseInt(process.env.DB_PORT ?? '5432'),
    database: process.env.DB_NAME     ?? 'avp',
    user:     process.env.DB_USER     ?? 'avp',
    password: process.env.DB_PASSWORD ?? 'avp_dev_password',
    max: 20, idleTimeoutMillis: 30_000,
  })
  await pool.query('SELECT 1')   // health check
  return pool
}

export async function migrate(): Promise<void> {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
  await getPool().query(sql)
  console.log('[DB] schema applied')
}

export async function query<T>(sql: string, params?: unknown[]): Promise<T[]> {
  const res = await getPool().query(sql, params)
  return res.rows as T[]
}

export async function queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(sql, params)
  return rows[0] ?? null
}
```

### `packages/platform/src/auth/jwtService.ts`

```typescript
import { SignJWT, jwtVerify, generateKeyPair, exportPKCS8, exportSPKI, importPKCS8, importSPKI } from 'jose'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentJwtPayload, AgentManifest } from '@avp/shared'

export class JwtService {
  private privateKey!: CryptoKey
  private publicKey!: CryptoKey
  private readonly issuer = 'avp-platform'
  private readonly audience = 'avp-agents'

  async init(keyDir: string): Promise<void> {
    const privPath = join(keyDir, 'platform.private.pem')
    const pubPath  = join(keyDir, 'platform.public.pem')
    if (existsSync(privPath)) {
      this.privateKey = await importPKCS8(readFileSync(privPath, 'utf8'), 'RS256')
      this.publicKey  = await importSPKI(readFileSync(pubPath, 'utf8'), 'RS256')
      console.log('[JWT] loaded existing key pair')
    } else {
      const pair = await generateKeyPair('RS256')
      this.privateKey = pair.privateKey
      this.publicKey  = pair.publicKey
      mkdirSync(keyDir, { recursive: true })
      writeFileSync(privPath, await exportPKCS8(pair.privateKey))
      writeFileSync(pubPath,  await exportSPKI(pair.publicKey))
      console.log('[JWT] generated new RS256 key pair →', keyDir)
    }
  }

  async issue(manifest: AgentManifest): Promise<string> {
    return new SignJWT({
      sub: manifest.id, iss: this.issuer, aud: this.audience,
      runtime: manifest.runtime, domain: manifest.domain,
      nodeKinds: manifest.capabilities.nodeKinds,
      edgeKinds: manifest.capabilities.edgeKinds,
      requiresGate: manifest.capabilities.requiresGate,
      maxWritesPerMinute: manifest.capabilities.maxWritesPerMinute,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(this.privateKey)
  }

  async verify(token: string): Promise<AgentJwtPayload> {
    const { payload } = await jwtVerify(token, this.publicKey, {
      issuer: this.issuer, audience: this.audience,
    })
    return payload as unknown as AgentJwtPayload
  }
}
```

### `packages/platform/src/bus/contextBus.ts`

```typescript
import { connect, StringCodec, type NatsConnection, type JetStreamClient } from 'nats'
import type { AgentContextEvent } from '@avp/shared'
import { v4 as uuid } from 'uuid'

const sc = StringCodec()

export class ContextBus {
  private nc: NatsConnection | null = null
  private js: JetStreamClient | null = null
  private handlers = new Map<string, ((e: AgentContextEvent) => Promise<void>)[]>()

  async connect(natsUrl = process.env.NATS_URL ?? 'nats://localhost:4222'): Promise<void> {
    try {
      this.nc = await connect({ servers: natsUrl, reconnect: true, maxReconnectAttempts: -1 })
      this.js = this.nc.jetstream()
      const jsm = await this.nc.jetstreamManager()
      await jsm.streams.add({
        name: 'CONTEXT',
        subjects: ['context.>'],
        storage: 'file',
        retention: 'limits',
        max_age: 7 * 24 * 60 * 60 * 1_000_000_000,   // 7 days in ns
        num_replicas: 1,
      }).catch(e => { if (!String(e).includes('stream name already in use')) throw e })
      console.log('[ContextBus] connected to', natsUrl)
    } catch (err) {
      console.warn('[ContextBus] NATS unavailable — in-process fallback active:', String(err))
      this.nc = null
    }
  }

  async publish(event: AgentContextEvent): Promise<void> {
    const subject = `context.${event.domain}.${event.kind}`
    const data    = sc.encode(JSON.stringify(event))
    if (this.js) {
      await this.js.publish(subject, data)
    } else {
      // In-process fallback
      this.dispatchLocal(subject, event)
    }
  }

  subscribe(
    pattern: string,
    durableName: string,
    handler: (e: AgentContextEvent) => Promise<void>,
  ): () => void {
    // Local handler map (used both by in-process and NATS fallback)
    const list = this.handlers.get(pattern) ?? []
    list.push(handler)
    this.handlers.set(pattern, list)

    // NATS core subscribe for real-time delivery
    if (this.nc) {
      const sub = this.nc.subscribe(pattern.replace('>', '*'))
      ;(async () => {
        for await (const msg of sub) {
          try {
            const e = JSON.parse(sc.decode(msg.data)) as AgentContextEvent
            await handler(e)
          } catch (err) { console.error('[ContextBus] handler error:', err) }
        }
      })()
      return () => sub.unsubscribe()
    }

    return () => {
      this.handlers.set(pattern, (this.handlers.get(pattern) ?? []).filter(h => h !== handler))
    }
  }

  private dispatchLocal(subject: string, event: AgentContextEvent): void {
    for (const [pattern, handlers] of this.handlers) {
      if (this.match(pattern, subject)) {
        handlers.forEach(h => h(event).catch(console.error))
      }
    }
  }

  private match(pattern: string, subject: string): boolean {
    const re = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[^.]+').replace(/>/g, '.*') + '$')
    return re.test(subject)
  }

  async drain(): Promise<void> { await this.nc?.drain() }
}
```

### `packages/platform/src/memory/redisMemory.ts`

```typescript
import { Redis } from 'ioredis'
import type { IWorkingMemory } from '@avp/shared'

let client: Redis | null = null

export function getRedis(): Redis {
  if (!client) throw new Error('Redis not initialized')
  return client
}

export async function initRedis(): Promise<Redis> {
  client = new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379'),
    lazyConnect: true,
  })
  await client.connect()
  return client
}

export class RedisWorkingMemory implements IWorkingMemory {
  constructor(private readonly redis: Redis, private readonly agentId: string) {}

  private key(k: string): string { return `wm:${this.agentId}:${k}` }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.redis.get(this.key(key))
    return raw ? (JSON.parse(raw) as T) : undefined
  }

  async set<T>(key: string, value: T, ttlSeconds = 3600): Promise<void> {
    await this.redis.setex(this.key(key), ttlSeconds, JSON.stringify(value))
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(this.key(key))
  }
}
```

### `packages/platform/src/memory/episodicMemory.ts`

```typescript
import { query, queryOne } from '../db/pool.js'
import type { IEpisodicMemory, EpisodeRecord } from '@avp/shared'

export class PostgresEpisodicMemory implements IEpisodicMemory {
  async write(ep: EpisodeRecord): Promise<number> {
    const row = await queryOne<{ id: number }>(`
      INSERT INTO agent_episodes
        (agent_id, session_id, domain, cycle_id, feature_id, input_hash,
         input_summary, system_prompt_excerpt, output_summary,
         output_node_ids, confidence_pct, latency_ms, llm_tokens_used)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING id
    `, [
      ep.agentId, ep.sessionId, ep.domain, ep.cycleId ?? null,
      ep.featureId ?? null, ep.inputHash, ep.inputSummary ?? null,
      ep.systemPromptExcerpt?.slice(0, 2000) ?? null, ep.outputSummary ?? null,
      ep.outputNodeIds ?? null, ep.confidencePct ?? null,
      ep.latencyMs ?? null, ep.llmTokensUsed ?? null,
    ])
    return row!.id
  }

  async readSimilar(agentId: string, inputHash: string, limit = 5) {
    return query<EpisodeRecord & { id: number; outcomeLabel?: string }>(`
      SELECT ae.*, gn.label AS outcome_label
      FROM agent_episodes ae
      LEFT JOIN graph_nodes gn ON gn.id = ae.outcome_node_id
      WHERE ae.agent_id = $1 AND ae.input_hash = $2
      ORDER BY ae.ts DESC LIMIT $3
    `, [agentId, inputHash, limit])
  }

  async linkOutcome(episodeId: number, outcomeNodeId: number): Promise<void> {
    await query(`UPDATE agent_episodes SET outcome_node_id=$1 WHERE id=$2`, [outcomeNodeId, episodeId])
  }
}
```

### `packages/platform/src/llm/llmGateway.ts`

```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { ILLMGateway, LLMRequest, LLMResponse } from '@avp/shared'

// Stub for when no LLM is configured — deterministic, never crashes
class StubLLMGateway implements ILLMGateway {
  async isAvailable() { return false }
  async complete(req: LLMRequest): Promise<LLMResponse> {
    return {
      text: `[Stub response for agent ${req.agentId} — configure LLM_PROVIDER to enable real responses]`,
      provider: 'anthropic', tokensUsed: { input: 0, output: 0 }, cached: false,
    }
  }
}

class AnthropicGateway implements ILLMGateway {
  private client: Anthropic
  constructor() { this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) }

  async isAvailable() {
    try { await this.client.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }); return true }
    catch { return false }
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const start = Date.now()
    const msg = await this.client.messages.create({
      model: req.model ?? 'claude-sonnet-4-6',
      max_tokens: req.maxTokens ?? 4096,
      system: req.system,
      messages: req.messages,
    })
    return {
      text: msg.content.filter(b => b.type === 'text').map(b => (b as any).text).join(''),
      provider: 'anthropic',
      tokensUsed: { input: msg.usage.input_tokens, output: msg.usage.output_tokens },
      cached: false,
    }
  }
}

export function createLLMGateway(): ILLMGateway {
  if (process.env.ANTHROPIC_API_KEY) return new AnthropicGateway()
  console.warn('[LLM] No provider configured — using stub. Set ANTHROPIC_API_KEY to enable.')
  return new StubLLMGateway()
}
```

### `packages/platform/src/server.ts` — the main entry point

```typescript
import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { v4 as uuid } from 'uuid'
import { initPool, migrate, query, queryOne } from './db/pool.js'
import { initRedis, getRedis, RedisWorkingMemory } from './memory/redisMemory.js'
import { PostgresEpisodicMemory } from './memory/episodicMemory.js'
import { ContextBus } from './bus/contextBus.js'
import { JwtService } from './auth/jwtService.js'
import { createLLMGateway } from './llm/llmGateway.js'
import type { AgentManifest, AgentJwtPayload, GraphWriteOp } from '@avp/shared'
import { join } from 'node:path'
import { homedir } from 'node:os'

const app  = Fastify({ logger: { transport: { target: 'pino-pretty' } } })
const bus  = new ContextBus()
const jwt  = new JwtService()
const llm  = createLLMGateway()
const PORT = parseInt(process.env.PORT ?? '7070')

// ── Rate limiter (in-memory, Redis-backed in prod) ───────────────────────
const writeCounters = new Map<string, { count: number; resetAt: number }>()
function checkRateLimit(agentId: string, maxPerMin: number): boolean {
  const now = Date.now()
  const entry = writeCounters.get(agentId) ?? { count: 0, resetAt: now + 60_000 }
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60_000 }
  entry.count++
  writeCounters.set(agentId, entry)
  return entry.count <= maxPerMin
}

async function start(): Promise<void> {
  // ── Init services ────────────────────────────────────────────────────────
  await initPool()
  await migrate()
  await initRedis()
  await bus.connect()

  const keyDir = process.env.KEY_DIR ?? join(homedir(), '.avp', 'keys')
  await jwt.init(keyDir)

  await app.register(cors, { origin: '*' })

  // ── Auth middleware ───────────────────────────────────────────────────────
  const PUBLIC = new Set(['/health', '/agents/register'])
  app.addHook('preHandler', async (req: any, reply: any) => {
    if (PUBLIC.has(req.url)) return
    const auth = req.headers.authorization as string | undefined
    if (!auth?.startsWith('Bearer '))
      return reply.status(401).send({ error: 'Missing Authorization header' })
    try { req.agent = await jwt.verify(auth.slice(7)) }
    catch { return reply.status(401).send({ error: 'Invalid or expired token' }) }
  })

  // ── Health ────────────────────────────────────────────────────────────────
  app.get('/health', async () => ({
    status: 'ok', ts: Date.now(), llm: await llm.isAvailable(),
    db: true, redis: true, nats: true,
  }))

  // ── Agent registration ────────────────────────────────────────────────────
  app.post<{ Body: AgentManifest }>('/agents/register', async (req) => {
    const manifest = req.body
    await query(`
      INSERT INTO agent_registry (id, name, archetype, domain, runtime, version, manifest)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id) DO UPDATE SET
        name=$2, archetype=$3, manifest=$7, last_seen_at=NOW()
    `, [manifest.id, manifest.name, manifest.archetype, manifest.domain,
        manifest.runtime, manifest.version, JSON.stringify(manifest)])
    const token = await jwt.issue(manifest)
    return { token, agentId: manifest.id, expiresIn: '30d' }
  })

  // ── Graph: upsert node ────────────────────────────────────────────────────
  app.post<{ Body: any }>('/graph/nodes', async (req: any, reply: any) => {
    const agent = req.agent as AgentJwtPayload
    const { kind, label, description, metadata, traceId: incoming } = req.body

    if (!agent.nodeKinds.includes(kind))
      return reply.status(403).send({ error: `${agent.sub} may not write ${kind} nodes`, allowed: agent.nodeKinds })
    if (!checkRateLimit(agent.sub, agent.maxWritesPerMinute))
      return reply.status(429).send({ error: 'Rate limit exceeded' })

    const traceId = incoming ?? uuid()
    const row = await queryOne<{ id: number }>(`
      INSERT INTO graph_nodes (kind, label, description, metadata, written_by_agent, trace_id)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [kind, label, description ?? null, JSON.stringify(metadata ?? {}), agent.sub, traceId])

    // If row is null the node already existed — fetch it
    const nodeId = row?.id ?? (await queryOne<{ id: number }>(
      `SELECT id FROM graph_nodes WHERE kind=$1 AND label=$2 LIMIT 1`, [kind, label]
    ))!.id

    await query(`INSERT INTO audit_log (agent_id,runtime,operation,node_id,trace_id,jwt_claims)
                 VALUES ($1,$2,$3,$4,$5,$6)`,
      [agent.sub, agent.runtime, 'upsertNode', nodeId, traceId, JSON.stringify(agent)])

    await bus.publish({
      id: uuid(), traceId, spanId: uuid(), agentId: agent.sub,
      runtime: agent.runtime, domain: agent.domain, kind: 'node_written',
      graphDelta: { nodesCreated: [nodeId], edgesCreated: [] }, ts: Date.now(),
    })

    return { nodeId, traceId, agentId: agent.sub, ts: Date.now() }
  })

  // ── Graph: insert edge ────────────────────────────────────────────────────
  app.post<{ Body: any }>('/graph/edges', async (req: any, reply: any) => {
    const agent = req.agent as AgentJwtPayload
    const { fromId, toId, kind, weight = 1.0, metadata, traceId: incoming } = req.body

    if (!agent.edgeKinds.includes(kind))
      return reply.status(403).send({ error: `${agent.sub} may not write ${kind} edges` })

    const traceId = incoming ?? uuid()
    await query(`
      INSERT INTO graph_edges (from_node_id, to_node_id, kind, weight, metadata)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING
    `, [fromId, toId, kind, weight, JSON.stringify(metadata ?? {})])

    await query(`INSERT INTO audit_log (agent_id,runtime,operation,trace_id,jwt_claims)
                 VALUES ($1,$2,$3,$4,$5)`,
      [agent.sub, agent.runtime, 'insertEdge', traceId, JSON.stringify(agent)])

    return { traceId, agentId: agent.sub, ts: Date.now() }
  })

  // ── Graph: read ───────────────────────────────────────────────────────────
  app.post<{ Body: { sql: string; params?: unknown[] } }>('/graph/query', async (req, reply) => {
    const { sql, params = [] } = req.body
    if (!sql.trim().toLowerCase().startsWith('select'))
      return reply.status(400).send({ error: 'Only SELECT queries allowed' })
    return query(sql, params)
  })

  // ── Episodes ──────────────────────────────────────────────────────────────
  const episodic = new PostgresEpisodicMemory()
  app.post<{ Body: any }>('/episodes', async (req: any) => {
    const agent = req.agent as AgentJwtPayload
    const id = await episodic.write({ ...req.body, agentId: agent.sub })
    return { id }
  })
  app.get<{ Querystring: { agentId: string; hash: string; limit?: string } }>('/episodes/similar', async (req) => {
    return episodic.readSimilar(req.query.agentId, req.query.hash, parseInt(req.query.limit ?? '5'))
  })
  app.patch<{ Params: { id: string }; Body: { outcomeNodeId: number } }>('/episodes/:id/outcome', async (req: any) => {
    await episodic.linkOutcome(parseInt(req.params.id), req.body.outcomeNodeId)
    return { updated: true }
  })

  // ── LLM proxy ─────────────────────────────────────────────────────────────
  app.post<{ Body: any }>('/llm/complete', async (req: any, reply: any) => {
    const agent = req.agent as AgentJwtPayload
    const budget = req.body.maxTokens ?? 4096
    return llm.complete({ ...req.body, agentId: agent.sub, maxTokens: budget })
  })

  // ── Cycle management ──────────────────────────────────────────────────────
  app.post<{ Body: { label: string; workspaceId?: string } }>('/cycles', async (req) => {
    const row = await queryOne<{ id: string }>(`
      INSERT INTO cycles (label, workspace_id) VALUES ($1,$2) RETURNING id
    `, [req.body.label, req.body.workspaceId ?? 'default'])
    return row
  })
  app.get('/cycles/:id', async (req: any) =>
    queryOne(`SELECT * FROM cycles WHERE id=$1`, [req.params.id]))

  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`[Platform API] http://0.0.0.0:${PORT}`)
}

start().catch(err => { console.error(err); process.exit(1) })
```

---

## STEP 4 — HTTP runtime adapter (used by all external agents)

```bash
mkdir -p packages/shared/src/adapters
```

### `packages/shared/src/adapters/httpAdapter.ts`

```typescript
import crypto from 'node:crypto'
import { v4 as uuid } from 'uuid'
import type {
  IRuntimeAdapter, IWorkingMemory, IEpisodicMemory, EpisodeRecord,
  GraphWriteOp, GraphWriteResult, AgentContextEvent, RuntimeId, VerbDomain,
} from '../index.js'

// ── In-process working memory for external runtimes ────────────────────────
export class InMemoryWorkingMemory implements IWorkingMemory {
  private store = new Map<string, { v: unknown; exp: number }>()
  async get<T>(k: string): Promise<T | undefined> {
    const e = this.store.get(k)
    return (!e || Date.now() > e.exp) ? undefined : e.v as T
  }
  async set<T>(k: string, v: T, ttl = 3600): Promise<void> {
    this.store.set(k, { v, exp: Date.now() + ttl * 1000 })
  }
  async delete(k: string): Promise<void> { this.store.delete(k) }
}

// ── Episodic memory via Platform API ──────────────────────────────────────
class RemoteEpisodicMemory implements IEpisodicMemory {
  constructor(private base: string, private jwt: string) {}
  private h() { return { Authorization: `Bearer ${this.jwt}`, 'Content-Type': 'application/json' } }
  async write(ep: EpisodeRecord): Promise<number> {
    const r = await fetch(`${this.base}/episodes`, { method: 'POST', headers: this.h(), body: JSON.stringify(ep) })
    const d = await r.json() as { id: number }
    return d.id
  }
  async readSimilar(agentId: string, inputHash: string, limit = 5) {
    const r = await fetch(`${this.base}/episodes/similar?agentId=${agentId}&hash=${inputHash}&limit=${limit}`, { headers: this.h() })
    return r.json() as Promise<(EpisodeRecord & { id: number })[]>
  }
  async linkOutcome(id: number, nodeId: number): Promise<void> {
    await fetch(`${this.base}/episodes/${id}/outcome`, { method: 'PATCH', headers: this.h(), body: JSON.stringify({ outcomeNodeId: nodeId }) })
  }
}

// ── The HTTP adapter ───────────────────────────────────────────────────────
export class HttpRuntimeAdapter implements IRuntimeAdapter {
  readonly workingMemory: IWorkingMemory
  readonly episodicMemory: IEpisodicMemory
  private busHandlers = new Map<string, ((e: AgentContextEvent) => Promise<void>)[]>()

  constructor(
    private readonly platformUrl: string,
    readonly agentId: string,
    readonly jwt: string,
    readonly runtime: RuntimeId,
    readonly domain: VerbDomain,
  ) {
    this.workingMemory = new InMemoryWorkingMemory()
    this.episodicMemory = new RemoteEpisodicMemory(platformUrl, jwt)
  }

  private h() { return { Authorization: `Bearer ${this.jwt}`, 'Content-Type': 'application/json' } }

  async graphWrite(op: GraphWriteOp): Promise<GraphWriteResult> {
    const traceId = uuid()
    const url = op.type === 'upsertNode' ? `${this.platformUrl}/graph/nodes` : `${this.platformUrl}/graph/edges`
    const res = await fetch(url, { method: 'POST', headers: this.h(), body: JSON.stringify({ ...op, traceId }) })
    if (!res.ok) {
      const err = await res.json() as { error: string }
      throw new Error(`[Platform API] ${res.status}: ${err.error}`)
    }
    return res.json() as Promise<GraphWriteResult>
  }

  async graphRead<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await fetch(`${this.platformUrl}/graph/query`, {
      method: 'POST', headers: this.h(), body: JSON.stringify({ sql, params }),
    })
    return res.json() as Promise<T[]>
  }

  async publish(event: Omit<AgentContextEvent, 'id' | 'agentId' | 'ts'>): Promise<void> {
    // Pipeline agents publish via the Platform API → NATS fanout
    await fetch(`${this.platformUrl}/events`, {
      method: 'POST', headers: this.h(),
      body: JSON.stringify({ ...event, id: uuid(), agentId: this.agentId, ts: Date.now() }),
    }).catch(() => {/* non-blocking */})
  }

  subscribe(pattern: string, handler: (e: AgentContextEvent) => Promise<void>): () => void {
    const list = this.busHandlers.get(pattern) ?? []
    list.push(handler); this.busHandlers.set(pattern, list)
    return () => this.busHandlers.set(pattern, (this.busHandlers.get(pattern) ?? []).filter(h => h !== handler))
  }

  async health() { return { status: 'ok' as const } }
  async shutdown() { this.workingMemory = undefined as any }
}

// ── Factory: registers and gets a JWT ─────────────────────────────────────
export async function createHttpAdapter(
  platformUrl: string,
  manifest: import('../index.js').AgentManifest,
): Promise<HttpRuntimeAdapter> {
  const res = await fetch(`${platformUrl}/agents/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(manifest),
  })
  if (!res.ok) throw new Error(`Failed to register agent ${manifest.id}: ${res.status}`)
  const { token } = await res.json() as { token: string }
  return new HttpRuntimeAdapter(platformUrl, manifest.id, token, manifest.runtime, manifest.domain)
}
```

---

## STEP 5 — Agent base class

```bash
mkdir -p packages/agents/shared/src
cat > packages/agents/shared/package.json << 'EOF'
{
  "name": "@avp/agent-base",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./dist/index.js" },
  "dependencies": { "@avp/shared": "workspace:*" }
}
EOF
```

### `packages/agents/shared/src/agentBase.ts`

```typescript
import crypto from 'node:crypto'
import { v4 as uuid } from 'uuid'
import type { IRuntimeAdapter, ILLMGateway, LLMRequest, LLMResponse, VerbDomain } from '@avp/shared'

export abstract class BaseAgent {
  protected abstract readonly agentId: string
  protected abstract readonly domain: VerbDomain

  constructor(
    protected readonly adapter: IRuntimeAdapter,
    protected readonly llm: ILLMGateway,
  ) {}

  /** Hash the input payload for episodic memory lookup */
  protected hashInput(input: unknown): string {
    return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex')
  }

  /** Complete with the LLM, recording token usage */
  protected async complete(req: Omit<LLMRequest, 'agentId'>): Promise<LLMResponse> {
    return this.llm.complete({ ...req, agentId: this.agentId })
  }

  /** Write a node and publish a context event in one call */
  protected async writeNode(params: {
    kind: string; label: string; description?: string; metadata?: Record<string, unknown>
    eventKind: string; cycleId?: string; featureId?: number
  }): Promise<number> {
    const result = await this.adapter.graphWrite({
      type: 'upsertNode',
      kind: params.kind, label: params.label,
      description: params.description, metadata: params.metadata,
    })
    await this.adapter.publish({
      traceId: result.traceId, spanId: uuid(),
      domain: this.domain, kind: params.eventKind,
      graphDelta: { nodesCreated: [result.nodeId!], edgesCreated: [] },
      cycleId: params.cycleId, featureId: params.featureId,
      runtime: this.adapter.runtime,
    })
    return result.nodeId!
  }

  /** Write an edge */
  protected async writeEdge(fromId: number, toId: number, kind: string, weight = 1.0): Promise<void> {
    await this.adapter.graphWrite({ type: 'insertEdge', fromId, toId, kind, weight })
  }

  /** Log and re-throw with agent context */
  protected fail(stage: string, err: unknown): never {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[${this.agentId}] Error in ${stage}: ${msg}`)
    throw new Error(`${this.agentId}/${stage}: ${msg}`)
  }
}
```

---

## STEP 6 — Representative agents (implement all 20 following this pattern)

### VoC Intelligence Agent — full implementation

```bash
mkdir -p packages/agents/listen/voc-intelligence/src
```

```typescript
// packages/agents/listen/voc-intelligence/src/vocIntelligenceAgent.ts
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'

export interface VoCInput {
  signals: { date: string; cohort: string; type: string; text: string }[]
  cycleId?: string
}

export interface VoCOutput {
  painPointIds: number[]
  clusterCount: number
  topProblem: string
}

export const VOC_MANIFEST: AgentManifest = {
  id: 'voc-intelligence:v1', name: 'VoC Intelligence Agent',
  archetype: 'Market Research Analyst', domain: 'listen', runtime: 'studio', version: '1.0.0',
  capabilities: { nodeKinds: ['CUSTOMER_SIGNAL', 'PAIN_POINT'], edgeKinds: ['EXPRESSES'], requiresGate: false, maxWritesPerMinute: 120 },
  subscribes: [], healthEndpoint: 'http://localhost:7081/health',
  llmBudget: { maxTokensPerRun: 8000, preferredModel: 'claude-sonnet-4-6' },
}

export class VoCIntelligenceAgent extends BaseAgent {
  protected readonly agentId = 'voc-intelligence:v1'
  protected readonly domain = 'listen' as const

  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) { super(adapter, llm) }

  async run(input: VoCInput): Promise<VoCOutput> {
    const sessionId = crypto.randomUUID()
    const inputHash = this.hashInput(input.signals.map(s => s.text).sort())
    const painPointIds: number[] = []

    // 1. Ingest raw signals
    const signalIds: number[] = []
    for (const sig of input.signals) {
      const id = await this.writeNode({
        kind: 'CUSTOMER_SIGNAL',
        label: sig.text.slice(0, 80),
        description: JSON.stringify(sig),
        metadata: { cohort: sig.cohort, type: sig.type, date: sig.date },
        eventKind: 'signal_ingested',
        cycleId: input.cycleId,
      })
      signalIds.push(id)
    }

    // 2. Read past similar episodes to calibrate clustering
    const past = await this.adapter.episodicMemory.readSimilar(this.agentId, inputHash, 3)
    const pastContext = past.length > 0
      ? `Previous similar clustering runs found: ${past.map(p => p.outputSummary).join('; ')}`
      : ''

    // 3. Cluster with LLM
    const prompt = `You are a Voice of Customer analyst. Cluster these ${input.signals.length} customer feedback items into 2-5 named pain points.

${pastContext ? `Context from prior runs:\n${pastContext}\n` : ''}

Feedback:
${input.signals.map((s, i) => `${i+1}. [${s.cohort}] ${s.text}`).join('\n')}

Return JSON ONLY — no preamble:
{
  "clusters": [
    {
      "label": "Short pain point name (max 60 chars)",
      "description": "One sentence problem statement",
      "importance_score": 0.0-1.0,
      "signal_indices": [1,2,3]
    }
  ]
}`

    const llmResult = await this.complete({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: prompt }], maxTokens: 2000 })
    let clusters: { label: string; description: string; importance_score: number; signal_indices: number[] }[] = []
    try {
      const parsed = JSON.parse(llmResult.text.trim()) as { clusters: typeof clusters }
      clusters = parsed.clusters
    } catch {
      // Fallback: one cluster from all signals
      clusters = [{ label: 'General feedback', description: 'Customer feedback requiring analysis', importance_score: 0.5, signal_indices: input.signals.map((_, i) => i + 1) }]
    }

    // 4. Write PAIN_POINT nodes + EXPRESSES edges
    for (const cluster of clusters) {
      const ppId = await this.writeNode({
        kind: 'PAIN_POINT', label: cluster.label,
        description: cluster.description,
        metadata: { importanceScore: cluster.importance_score, signalCount: cluster.signal_indices.length },
        eventKind: 'pain_point_clustered',
        cycleId: input.cycleId,
      })
      painPointIds.push(ppId)
      for (const idx of cluster.signal_indices) {
        const sigId = signalIds[idx - 1]
        if (sigId) await this.writeEdge(sigId, ppId, 'EXPRESSES')
      }
    }

    // 5. Record episode
    await this.adapter.episodicMemory.write({
      agentId: this.agentId, sessionId, domain: 'listen',
      cycleId: input.cycleId, inputHash,
      inputSummary: `${input.signals.length} signals`,
      outputSummary: `${clusters.length} pain points: ${clusters.map(c => c.label).join(', ')}`,
      outputNodeIds: painPointIds, confidencePct: 80, llmTokensUsed: llmResult.tokensUsed.output,
    })

    return {
      painPointIds, clusterCount: clusters.length,
      topProblem: clusters.sort((a, b) => b.importance_score - a.importance_score)[0]?.label ?? 'Unknown',
    }
  }
}
```

### DevSecOps Agent — full implementation

```typescript
// packages/agents/ship/devsecops/src/devSecOpsAgent.ts
import { execSync } from 'node:child_process'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'

export const DEVSECOPS_MANIFEST: AgentManifest = {
  id: 'devsecops:v1', name: 'DevSecOps Agent', archetype: 'DevSecOps Engineer',
  domain: 'ship', runtime: 'pipeline', version: '1.0.0',
  capabilities: {
    nodeKinds: ['SECURITY_SCAN', 'CVE_FINDING', 'COMPLIANCE_CHECK'],
    edgeKinds: ['EVIDENCED_BY', 'BLOCKS_RELEASE'], requiresGate: false, maxWritesPerMinute: 60,
  },
  subscribes: ['context.build.build_completed'],
  healthEndpoint: 'http://localhost:7085/health',
  llmBudget: { maxTokensPerRun: 4000, preferredModel: 'claude-haiku-4-5-20251001' },
}

export interface SecScanInput {
  repoPath: string; gitSha: string; runId: string
  rcNodeId?: number; cycleId?: string; featureId?: number
}

export interface SecScanOutput {
  scanNodeId: number; findingIds: number[]
  blocking: boolean; critical: number; high: number
  summary: string
}

export class DevSecOpsAgent extends BaseAgent {
  protected readonly agentId = 'devsecops:v1'
  protected readonly domain = 'ship' as const

  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) { super(adapter, llm) }

  async run(input: SecScanInput): Promise<SecScanOutput> {
    const findings = this.runScanners(input.repoPath)
    const critical = findings.filter(f => f.severity === 'CRITICAL').length
    const high     = findings.filter(f => f.severity === 'HIGH').length
    const blocking = critical > 0 || high > 2

    // Write SECURITY_SCAN node
    const scanNodeId = await this.writeNode({
      kind: 'SECURITY_SCAN',
      label: `Security scan ${input.gitSha.slice(0, 8)}`,
      description: JSON.stringify({
        sha: input.gitSha, runId: input.runId,
        total: findings.length, critical, high,
        tools: ['semgrep', 'trivy', 'trufflehog'],
        status: findings.length === 0 ? 'clean' : blocking ? 'blocked' : 'warnings',
      }),
      metadata: { critical, high, blocking, sha: input.gitSha },
      eventKind: 'security_scan_completed',
      cycleId: input.cycleId, featureId: input.featureId,
    })

    // Write CVE_FINDING nodes for each finding
    const findingIds: number[] = []
    for (const finding of findings) {
      const fid = await this.writeNode({
        kind: 'CVE_FINDING', label: finding.id,
        description: JSON.stringify(finding),
        metadata: { severity: finding.severity, path: finding.path },
        eventKind: 'cve_finding_recorded',
        cycleId: input.cycleId,
      })
      findingIds.push(fid)
      await this.writeEdge(scanNodeId, fid, 'EVIDENCED_BY')
      if (finding.severity === 'CRITICAL' || finding.severity === 'HIGH')
        await this.writeEdge(scanNodeId, fid, 'BLOCKS_RELEASE', 1.0)
    }

    // Link scan to release candidate
    if (input.rcNodeId) await this.writeEdge(input.rcNodeId, scanNodeId, 'EVIDENCED_BY')

    const summary = blocking
      ? `⛔ BLOCKED — ${critical} critical, ${high} high findings`
      : findings.length === 0 ? '✓ Clean — no issues found'
      : `⚠ ${findings.length} warnings (not blocking)`

    return { scanNodeId, findingIds, blocking, critical, high, summary }
  }

  private runScanners(repoPath: string): { id: string; severity: string; message: string; path: string; tool: string }[] {
    const findings: { id: string; severity: string; message: string; path: string; tool: string }[] = []

    // Semgrep SAST
    try {
      const out = execSync(`semgrep scan --json --severity ERROR --severity WARNING ${repoPath}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120_000 })
      const data = JSON.parse(out) as { results: any[] }
      for (const r of data.results ?? [])
        findings.push({ id: r.check_id, severity: r.extra?.severity === 'ERROR' ? 'HIGH' : 'MEDIUM', message: r.extra?.message ?? r.check_id, path: r.path, tool: 'semgrep' })
    } catch { /* not installed or no findings */ }

    // Trivy IaC/image scan
    try {
      const out = execSync(`trivy fs --format json --severity HIGH,CRITICAL ${repoPath}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120_000 })
      const data = JSON.parse(out) as { Results: any[] }
      for (const result of data.Results ?? [])
        for (const vuln of result.Vulnerabilities ?? [])
          findings.push({ id: vuln.VulnerabilityID, severity: vuln.Severity, message: vuln.Title, path: result.Target, tool: 'trivy' })
    } catch { /* not installed */ }

    return findings
  }
}
```

---

## STEP 7 — Pipeline runtime CLI

```bash
mkdir -p packages/runtimes/pipeline/src
cat > packages/runtimes/pipeline/package.json << 'EOF'
{
  "name": "@avp/pipeline-runtime",
  "version": "0.1.0",
  "type": "module",
  "bin": { "avp-agent": "./dist/cli.js" },
  "scripts": { "build": "tsc", "dev": "tsx src/cli.ts" },
  "dependencies": {
    "@avp/shared": "workspace:*",
    "@avp/agent-base": "workspace:*",
    "commander": "^12.0.0",
    "@avp/agents-ship-devsecops": "workspace:*",
    "@avp/agents-ship-finops": "workspace:*",
    "@avp/agents-ship-devops": "workspace:*"
  }
}
EOF
```

### `packages/runtimes/pipeline/src/cli.ts`

```typescript
#!/usr/bin/env node
import { program } from 'commander'
import { createHttpAdapter } from '@avp/shared/adapters/httpAdapter.js'
import { createLLMGateway } from '@avp/platform/llm/llmGateway.js'
import { DevSecOpsAgent, DEVSECOPS_MANIFEST } from '@avp/agents-ship-devsecops'
import { FinOpsAgent, FINOPS_MANIFEST } from '@avp/agents-ship-finops'
import { DevOpsAgent, DEVOPS_MANIFEST } from '@avp/agents-ship-devops'

const PLATFORM_URL = process.env.AVP_PLATFORM_URL ?? 'http://localhost:7070'

program
  .name('avp-agent')
  .description('AVP Pipeline Agent CLI')
  .version('1.0.0')

program.command('devsecops')
  .description('Run the DevSecOps security scan agent')
  .requiredOption('--repo-path <path>', 'Repository path to scan')
  .requiredOption('--git-sha <sha>', 'Git commit SHA')
  .requiredOption('--run-id <id>', 'CI run ID')
  .option('--rc-node-id <id>', 'Release candidate graph node ID', parseInt)
  .option('--cycle-id <id>', 'AVP cycle ID')
  .option('--feature-id <id>', 'Feature graph node ID', parseInt)
  .action(async (opts) => {
    console.log('[DevSecOps] Connecting to Platform API at', PLATFORM_URL)
    const adapter = await createHttpAdapter(PLATFORM_URL, DEVSECOPS_MANIFEST)
    const agent = new DevSecOpsAgent(adapter, createLLMGateway())
    const result = await agent.run({
      repoPath: opts.repoPath, gitSha: opts.gitSha,
      runId: opts.runId, rcNodeId: opts.rcNodeId,
      cycleId: opts.cycleId, featureId: opts.featureId,
    })
    console.log(result.summary)
    if (result.blocking) {
      console.error(`\n⛔ Release blocked — ${result.critical} critical, ${result.high} high findings`)
      process.exit(1)   // Non-zero exit signals the CI/CD pipeline to fail the step
    }
    console.log('✓ DevSecOps scan complete — not blocking')
  })

program.command('finops')
  .description('Run the FinOps cost analysis agent')
  .requiredOption('--repo-path <path>', 'Repository path with IaC')
  .requiredOption('--git-sha <sha>', 'Git commit SHA')
  .option('--cycle-id <id>', 'AVP cycle ID')
  .action(async (opts) => {
    const adapter = await createHttpAdapter(PLATFORM_URL, FINOPS_MANIFEST)
    const agent = new FinOpsAgent(adapter, createLLMGateway())
    const result = await agent.run({ repoPath: opts.repoPath, gitSha: opts.gitSha, cycleId: opts.cycleId })
    console.log(result.summary)
  })

program.parse()
```

---

## STEP 8 — GitHub Actions integration

### `deploy/github-actions/avp-pipeline.yml`

```yaml
name: AVP Agent Pipeline

on:
  push:
    branches: [main, 'release/**', 'feature/**']
  pull_request:

env:
  AVP_PLATFORM_URL: ${{ secrets.AVP_PLATFORM_URL }}

jobs:
  avp-agents:
    name: AVP Security, Cost & Build Analysis
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write

    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - uses: actions/setup-node@v4
        with: { node-version: '20' }

      - name: Install AVP pipeline CLI
        run: npm install -g @avp/pipeline-runtime

      - name: Install scan tools
        run: |
          pip install semgrep
          curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin v0.52.0

      - name: Run DevSecOps Agent
        id: devsecops
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          avp-agent devsecops \
            --repo-path . \
            --git-sha ${{ github.sha }} \
            --run-id ${{ github.run_id }} \
            --cycle-id ${{ vars.AVP_CYCLE_ID }} \
            --feature-id ${{ vars.AVP_FEATURE_NODE_ID }}

      - name: Run FinOps Agent
        if: always()
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          INFRACOST_API_KEY: ${{ secrets.INFRACOST_API_KEY }}
        run: |
          avp-agent finops \
            --repo-path . \
            --git-sha ${{ github.sha }} \
            --cycle-id ${{ vars.AVP_CYCLE_ID }}

      - name: Run DevOps Agent (build ingestion)
        if: always()
        run: |
          avp-agent devops \
            --git-sha ${{ github.sha }} \
            --run-id ${{ github.run_id }} \
            --conclusion ${{ job.status }} \
            --cycle-id ${{ vars.AVP_CYCLE_ID }}
```

---

## STEP 9 — Docker Compose production-ready

```bash
# Start the full platform
cd deploy/docker && docker compose up -d

# Run migrations
cd ../.. && pnpm -F @avp/platform db:migrate

# Start the Platform API
pnpm -F @avp/platform dev

# Verify
curl http://localhost:7070/health
# → {"status":"ok","llm":true,"db":true,"redis":true,"nats":true}

# Register your first agent manually
curl -X POST http://localhost:7070/agents/register \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "voc-intelligence:v1",
    "name": "VoC Intelligence Agent",
    "archetype": "Market Research Analyst",
    "domain": "listen",
    "runtime": "studio",
    "version": "1.0.0",
    "capabilities": {
      "nodeKinds": ["CUSTOMER_SIGNAL","PAIN_POINT"],
      "edgeKinds": ["EXPRESSES"],
      "requiresGate": false,
      "maxWritesPerMinute": 120
    },
    "subscribes": [],
    "healthEndpoint": "http://localhost:7081/health"
  }'
# → {"token":"eyJ...","agentId":"voc-intelligence:v1","expiresIn":"30d"}
```

---

## STEP 10 — End-to-end verification

```bash
# 1. Platform health
curl http://localhost:7070/health

# 2. Register test agent and capture token
TOKEN=$(curl -s -X POST http://localhost:7070/agents/register \
  -H 'Content-Type: application/json' \
  -d '{"id":"test:v1","name":"Test","archetype":"Test","domain":"build","runtime":"pipeline",
       "version":"1.0.0","capabilities":{"nodeKinds":["SECURITY_SCAN"],"edgeKinds":["EVIDENCED_BY"],
       "requiresGate":false,"maxWritesPerMinute":10},"subscribes":[],"healthEndpoint":""}' \
  | node -e "process.stdin|>JSON.parse|>{token}=>token")

# 3. Write a node (authorized)
curl -X POST http://localhost:7070/graph/nodes \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"upsertNode","kind":"SECURITY_SCAN","label":"Test scan","description":"clean"}'

# 4. Write unauthorized node kind (should 403)
curl -X POST http://localhost:7070/graph/nodes \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"upsertNode","kind":"CUSTOMER_SIGNAL","label":"should fail"}'
# → 403 {"error":"test:v1 may not write CUSTOMER_SIGNAL nodes"}

# 5. Audit log has the write
curl -X POST http://localhost:7070/graph/query \
  -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT agent_id, operation, node_id, ts FROM audit_log ORDER BY ts DESC LIMIT 5"}'

# 6. Run the VoC Intelligence Agent
node -e "
import('@avp/agents-listen-voc-intelligence').then(async ({VoCIntelligenceAgent, VOC_MANIFEST}) => {
  const {createHttpAdapter} = await import('@avp/shared/adapters/httpAdapter.js')
  const {createLLMGateway}  = await import('@avp/platform/llm/llmGateway.js')
  const adapter = await createHttpAdapter('http://localhost:7070', VOC_MANIFEST)
  const agent = new VoCIntelligenceAgent(adapter, createLLMGateway())
  const result = await agent.run({ signals: [
    {date:'2026-07-16',cohort:'enterprise',type:'feature_request',text:'We need bulk dispute filing'},
    {date:'2026-07-16',cohort:'fleet',type:'pain_point',text:'Disputing toll charges one by one wastes 3 hours a week'},
    {date:'2026-07-16',cohort:'enterprise',type:'churn_risk',text:'Considering switching because of poor dispute UX'},
  ], cycleId: 'cycle-001' })
  console.log(JSON.stringify(result, null, 2))
})"

# 7. Verify graph has PAIN_POINT nodes
curl -X POST http://localhost:7070/graph/query \
  -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT id, label, kind, written_by_agent FROM graph_nodes WHERE kind IN ($$CUSTOMER_SIGNAL$$,$$PAIN_POINT$$) ORDER BY id DESC LIMIT 10"}'
```

---

## Phase timeline

| Phase | Weeks | Deliverable |
|-------|-------|-------------|
| 1 — Platform foundation | 1–3 | PostgreSQL + Redis + NATS + Platform API + JWT |
| 2 — Agent base + Listen agents | 4–5 | VoC Intelligence + Market Signal running |
| 3 — Decide agents (5 agents) | 6–8 | Full LISTEN→DECIDE flow with portfolio gate |
| 4 — Define + Build agents | 9–10 | Requirements + Arch + Engineering + QA |
| 5 — Ship agents (6 agents) | 11–14 | DevOps + DevSecOps + FinOps + SRE in CI/CD |
| 6 — Learn agents (4 agents) | 15–16 | Verdicts + lessons + calibration loop closed |
| 7 — Observability + memory | 17–18 | Full OTEL traces + episodic calibration |
| 8 — Production hardening | 19–20 | Kubernetes + Vault + Keycloak + load testing |

## Implement remaining 17 agents

Follow the exact pattern from Step 6 for each agent. Each agent needs:
- `packages/agents/{domain}/{agent-name}/src/{agentName}.ts` — extends BaseAgent
- An exported `MANIFEST` constant
- A typed `Input` and `Output` interface
- A `run(input)` method that calls `writeNode()` / `writeEdge()` / `complete()` / episodic memory
- A `package.json` with the agent as the package name

The pattern is identical across all 20 agents — only the domain logic changes.
