# Plan 1 — Step 3 Implementation Record

**Date**: 2026-07-16  
**Plan source**: `aop_implementation_plan_p1.md` (STEP 3 — Platform API server)  
**Status**: Complete and verified — API listening on `http://0.0.0.0:7070`  

---

## 1. Objective

Build the **Agent Operating Platform (AOP) API** — the control plane that all agents and runtimes talk to. Step 3 delivers:

| Capability | Implementation |
|------------|----------------|
| HTTP API | Fastify on port **7070** |
| Persistence | PostgreSQL schema (graph, registry, audit, episodes, cycles, calibration) |
| Working memory | Redis connection + `RedisWorkingMemory` |
| Context bus | NATS JetStream `CONTEXT` stream (`context.>`) with in-process fallback |
| Auth | RS256 JWT issue/verify from agent manifests |
| LLM proxy | Anthropic gateway when keyed; otherwise safe stub |
| Policy | Capability-scoped graph writes + per-agent rate limit |

Depends on Step 1 (`@avp/shared`) and Step 2 (Docker infra). No agents yet (Steps 5–6).

---

## 2. Starting state

- `@avp/shared` built and available as `workspace:*`
- Docker stack healthy (Postgres, Redis, NATS, Jaeger, Grafana, Prometheus, MinIO)
- No `packages/platform` yet

---

## 3. Package scaffold

### 3.1 Files created

```
packages/platform/
├── package.json
├── tsconfig.json
├── .env.example
└── src/
    ├── server.ts                 # Fastify entrypoint
    ├── db/
    │   ├── schema.sql            # Idempotent DDL
    │   ├── pool.ts               # pg Pool + migrate/query helpers
    │   └── migrate.ts            # CLI: pnpm db:migrate
    ├── auth/
    │   └── jwtService.ts         # RS256 issue/verify
    ├── bus/
    │   └── contextBus.ts         # NATS JetStream + local fallback
    ├── memory/
    │   ├── redisMemory.ts        # Redis init + IWorkingMemory
    │   └── episodicMemory.ts     # Postgres IEpisodicMemory
    ├── llm/
    │   └── llmGateway.ts         # Stub + Anthropic
    ├── policy/.gitkeep           # Reserved (plan dirs)
    ├── registry/.gitkeep
    ├── telemetry/.gitkeep
    └── routes/.gitkeep
```

### 3.2 `package.json` highlights

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `tsx watch src/server.ts` | Hot-reload API for local development |
| `build` | `tsc && cp src/db/schema.sql dist/db/` | Compile + ship SQL next to compiled JS |
| `db:migrate` | `tsx src/db/migrate.ts` | Apply schema without starting HTTP |
| `start` | `node dist/server.js` | Run compiled server |

**Dependencies** (from plan + required additions):

| Package | Why |
|---------|-----|
| `@avp/shared` | Shared types (`AgentManifest`, JWT payload, etc.) |
| `fastify` / `@fastify/cors` | HTTP server |
| `pg` | Postgres |
| `ioredis` | Redis |
| `nats` | Context bus |
| `jose` | JWT RS256 |
| `uuid` | Trace/event IDs |
| `pino` / `pino-pretty` | Logging |
| `@opentelemetry/*` | Installed for later telemetry wiring (not activated in Step 3 routes) |
| `@anthropic-ai/sdk` | **Added** — plan imports it but omitted from `package.json` |
| `dotenv` | **Added** — plan uses `import 'dotenv/config'` |

**DevDependencies**: `tsx`, `typescript`, `@types/node`, `@types/pg`, `@types/uuid`

### 3.3 TypeScript config

`packages/platform/tsconfig.json` extends `tsconfig.base.json`, emits to `dist/`, and references `@avp/shared` via project references.

---

## 4. Database schema (`src/db/schema.sql`)

Applied on every server start (`migrate()`) and via `pnpm -F @avp/platform db:migrate`.

### 4.1 Extensions

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

- `vector` — embeddings on `graph_nodes` (semantic search later)
- `pgcrypto` — ensures `gen_random_uuid()` for `cycles.id`

### 4.2 Tables

| Table | Role |
|-------|------|
| `graph_nodes` | Knowledge graph vertices (`kind`, `label`, `metadata`, optional `embedding vector(1536)`) |
| `graph_edges` | Typed edges with `UNIQUE(from_node_id, to_node_id, kind)` |
| `agent_registry` | Registered agents + full manifest JSON |
| `audit_log` | Immutable write audit (agent, operation, node/edge, trace, JWT claims) |
| `agent_episodes` | Episodic memory rows for calibration / similar-input lookup |
| `cycles` | Value-stream cycle state (`current_stage` defaults to `LISTEN`) |
| `agent_calibration` | Predicted vs actual KPI records (schema ready; API later) |

### 4.3 Schema fixes vs plan snippet

| Issue in plan | Fix applied |
|---------------|-------------|
| `CREATE INDEX ON ...` without `IF NOT EXISTS` | Named `CREATE INDEX IF NOT EXISTS` so migrate is idempotent |
| Node upsert `ON CONFLICT DO NOTHING` with **no unique constraint** | Added `UNIQUE (workspace_id, kind, label)` and real `ON CONFLICT ... DO UPDATE` |
| Indexes unnamed | Explicit names for clarity/ops |

Verified tables after migrate:

```
agent_calibration, agent_episodes, agent_registry,
audit_log, cycles, graph_edges, graph_nodes
```

---

## 5. Module-by-module implementation

### 5.1 `db/pool.ts`

- Creates a `pg.Pool` from env (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`)
- `initPool()` — connect + `SELECT 1`
- `migrate()` — read `schema.sql` from disk relative to module and execute
- `query` / `queryOne` — typed helpers
- `closePool()` — used by the migrate CLI

**Default port**: `5433` (see §8 — host Postgres conflict).

### 5.2 `db/migrate.ts`

Standalone CLI:

```bash
pnpm -F @avp/platform db:migrate
```

Calls `initPool()` → `migrate()` → `closePool()`.

### 5.3 `auth/jwtService.ts`

- On `init(keyDir)`: load `platform.private.pem` / `platform.public.pem` or generate RS256 keypair
- Default key dir: `~/.avp/keys` (override with `KEY_DIR`)
- `issue(manifest)` → JWT with subject = agent id, claims for `runtime`, `domain`, `nodeKinds`, `edgeKinds`, `requiresGate`, `maxWritesPerMinute`, expiry **30d**
- `verify(token)` → `AgentJwtPayload`

**Type fix**: jose returns `KeyLike`, not DOM `CryptoKey` — private fields typed as `KeyLike`.

### 5.4 `bus/contextBus.ts`

- Connects to `NATS_URL` (default `nats://localhost:4222`)
- Ensures JetStream stream `CONTEXT` on subjects `context.>`
- `publish(event)` → subject `context.{domain}.{kind}`
- Falls back to in-process handler dispatch if NATS is down
- `isConnected()` exposed for `/health`

**Type fix**: use `StorageType.File` and `RetentionPolicy.Limits` enums (string literals rejected by `nats` typings).

### 5.5 `memory/redisMemory.ts`

- `initRedis()` with `lazyConnect` + `ping`
- `RedisWorkingMemory` implements `IWorkingMemory` with keys `wm:{agentId}:{key}` and TTL via `SETEX`

### 5.6 `memory/episodicMemory.ts`

- `PostgresEpisodicMemory` implements `IEpisodicMemory`
- `write` / `readSimilar` (by `agent_id` + `input_hash`) / `linkOutcome`

### 5.7 `llm/llmGateway.ts`

- `StubLLMGateway` when `ANTHROPIC_API_KEY` unset (`isAvailable() === false`)
- `AnthropicGateway` when key present
- Factory: `createLLMGateway()`

### 5.8 `server.ts` — HTTP surface

Startup order:

1. `initPool()` + `migrate()`
2. `initRedis()`
3. `bus.connect()`
4. `jwt.init(keyDir)`
5. Register CORS + auth hook
6. Register routes
7. `listen(0.0.0.0:7070)`

**Auth**: Bearer JWT required except `/health` and `/agents/register`. Path check strips query strings so `/episodes/similar?...` still requires auth.

**Rate limit**: in-memory per-agent counter for graph writes (plan notes Redis-backed in prod later).

#### Routes implemented

| Method | Path | Auth | Behavior |
|--------|------|------|----------|
| `GET` | `/health` | Public | `{ status, ts, llm, db, redis, nats }` |
| `POST` | `/agents/register` | Public | Upsert registry + return JWT |
| `POST` | `/graph/nodes` | JWT | Capability-checked upsert + audit + bus `node_written` |
| `POST` | `/graph/edges` | JWT | Capability-checked upsert + audit + bus `edge_written` |
| `POST` | `/graph/query` | JWT | SELECT-only SQL |
| `POST` | `/episodes` | JWT | Write episode (agentId from token) |
| `GET` | `/episodes/similar` | JWT | Similar episodes by agentId + hash |
| `PATCH` | `/episodes/:id/outcome` | JWT | Link outcome node |
| `POST` | `/llm/complete` | JWT | LLM proxy (stub or Anthropic) |
| `POST` | `/cycles` | JWT | Create cycle |
| `GET` | `/cycles/:id` | JWT | Fetch cycle |

---

## 6. Infrastructure adjustment during Step 3

### 6.1 Postgres host port → 5433

**Problem**: The machine already had a local Postgres listening on `localhost:5432`. Docker published `0.0.0.0:5432`, but Node clients connecting to `localhost` hit the **local** instance (role `avp` missing → migrate failed).

**Fix**:

1. Updated `deploy/docker/docker-compose.yml`:
   ```yaml
   ports:
     - '5433:5432'
   ```
2. Recreated the `postgres` service
3. Set platform default `DB_PORT` to **5433** (and `.env.example`)

**Verify**:

```text
0.0.0.0:5433->5432/tcp   (avp-postgres-1 healthy)
```

Redis (`6379`) and NATS (`4222`) had no conflicts and kept plan ports.

---

## 7. How it was done (command timeline)

```bash
# From repo root
pnpm install                          # pull platform deps into workspace
pnpm -F @avp/shared build
pnpm -F @avp/platform build           # tsc (+ copy schema.sql)

# After remapping Postgres → 5433
cd deploy/docker && docker compose up -d postgres

pnpm -F @avp/platform db:migrate      # schema applied

pnpm -F @avp/platform dev             # API on :7070
```

Build issues fixed before green compile:

1. `CryptoKey` → `KeyLike` in `jwtService.ts`
2. NATS stream `storage`/`retention` → enum values

---

## 8. Verification results

Server log showed:

```text
[DB] schema applied
[Redis] connected
[ContextBus] connected to nats://localhost:4222
[JWT] generated new RS256 key pair → ~/.avp/keys   # (or "loaded existing")
[LLM] No provider configured — using stub.
[Platform API] http://0.0.0.0:7070
```

### 8.1 Probe matrix

| # | Check | Result |
|---|-------|--------|
| 1 | `GET /health` | `status: ok`, `db/redis/nats: true`, `llm: false` (stub) |
| 2 | `POST /agents/register` (`test:v1`) | JWT issued, `expiresIn: 30d` |
| 3 | `POST /graph/nodes` `SECURITY_SCAN` | `nodeId: 1`, audit written, event published |
| 4 | `POST /graph/nodes` `CUSTOMER_SIGNAL` | **403** — capability denied |
| 5 | Node write without Bearer | **401** |
| 6 | `POST /graph/query` audit SELECT | Row for `upsertNode` / `test:v1` |
| 7 | `POST /cycles` | UUID returned |
| 8 | `GET /cycles/:id` | Full cycle row (`LISTEN`, `active`) |
| 9 | Episode write + `/episodes/similar` | Episode id `1` returned on lookup |
| 10 | `POST /llm/complete` | Stub text naming `test:v1` |

All checks passed.

### 8.2 Re-run verification

With the API running:

```bash
curl -sf http://localhost:7070/health | python3 -m json.tool

curl -sf -X POST http://localhost:7070/agents/register \
  -H 'Content-Type: application/json' \
  -d '{"id":"test:v1","name":"Test","archetype":"Test","domain":"build","runtime":"pipeline","version":"1.0.0","capabilities":{"nodeKinds":["SECURITY_SCAN"],"edgeKinds":["EVIDENCED_BY"],"requiresGate":false,"maxWritesPerMinute":10},"subscribes":[],"healthEndpoint":""}'
```

---

## 9. Runtime configuration

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `7070` | HTTP listen port |
| `DB_HOST` | `localhost` | Postgres host |
| `DB_PORT` | `5433` | Host-mapped Docker Postgres |
| `DB_NAME` / `DB_USER` | `avp` | Database credentials |
| `DB_PASSWORD` | `avp_dev_password` | Dev password (matches Compose) |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` | Redis |
| `NATS_URL` | `nats://localhost:4222` | Context bus |
| `KEY_DIR` | `~/.avp/keys` | JWT PEM storage |
| `ANTHROPIC_API_KEY` | unset | Enables real LLM gateway |

See `packages/platform/.env.example`.

---

## 10. What this unlocks

| Next step | Now possible because |
|-----------|----------------------|
| **Step 4** — HTTP runtime adapter | Stable register / graph / episodes / LLM HTTP APIs + JWT |
| **Step 5** — `BaseAgent` | Platform enforces capabilities agents will rely on |
| **Step 6+** — Domain agents | Can register, write graph nodes/edges, publish via bus |
| **Step 7–8** — Pipeline / CI | Same API URL (`AVP_PLATFORM_URL`) |

Note: Step 4’s plan references `POST /events` for publish fan-out. That route is **not** in the Step 3 plan and was not added here; it can be added when implementing Step 4 (or agents can rely on graph-write side-effect publishes already done for nodes/edges).

---

## 11. Explicitly out of scope for this step

- HTTP runtime adapter / `BaseAgent` / domain agents
- OpenTelemetry exporter wiring (deps installed, not configured)
- Redis-backed rate limiting
- Production auth (Keycloak), Vault, K8s
- `POST /events` bus-only publish endpoint
- Grafana dashboards for platform metrics

---

## 12. Day-to-day commands

```bash
# Infra (if not running)
cd deploy/docker && docker compose up -d

# Migrate only
pnpm -F @avp/platform db:migrate

# Dev API (hot reload)
pnpm -F @avp/platform dev

# Production-style
pnpm -F @avp/platform build
pnpm -F @avp/platform start
```

API base URL: **http://localhost:7070**

---

## 13. Summary

Step 3 delivered a working `@avp/platform` Fastify server that migrates the full AOP schema, connects to Redis and NATS, issues capability-scoped JWTs, enforces graph write policy, audits mutations, publishes context events, stores episodes, proxies LLM calls (stub by default), and manages value cycles. Postgres was remapped to host port **5433** to avoid a local Postgres conflict. End-to-end probes (health, register, authorized/unauthorized writes, audit, cycles, episodes, LLM stub) all succeeded.
