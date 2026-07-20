# Plan 1 — Step 4 Implementation Record

**Date**: 2026-07-16  
**Plan source**: `aop_implementation_plan_p1.md` (STEP 4 — HTTP runtime adapter)  
**Status**: Complete and verified against Platform API on `:7070`  

---

## 1. Objective

Give every external agent (CLI, CI, IDE, Slack, workers) a single client that speaks the Platform API through the shared `IRuntimeAdapter` contract from Step 1.

Step 4 delivers:

| Piece | Role |
|-------|------|
| `HttpRuntimeAdapter` | Implements `IRuntimeAdapter` over HTTP + JWT |
| `createHttpAdapter()` | Registers an `AgentManifest`, receives a JWT, returns a ready adapter |
| `InMemoryWorkingMemory` | Process-local TTL key/value store (no Redis required in the agent process) |
| `RemoteEpisodicMemory` | Episodes via Platform `/episodes*` endpoints |
| `POST /events` on Platform | Completes the adapter’s `publish()` path → NATS fan-out |

After this step, agents do not call Fastify routes by hand; they call `adapter.graphWrite()`, `adapter.publish()`, etc.

---

## 2. Starting state

- Step 1: `@avp/shared` types (`IRuntimeAdapter`, `GraphWriteOp`, …)
- Step 2: Docker infra healthy
- Step 3: Platform API running (`pnpm -F @avp/platform dev` on port **7070**)
- No `packages/shared/src/adapters/` yet
- Step 3 explicitly deferred `POST /events` to Step 4

---

## 3. Files created / modified

### 3.1 Created

| Path | Purpose |
|------|---------|
| `packages/shared/src/adapters/httpAdapter.ts` | Full HTTP adapter + factory + in-memory WM |
| `plan1_step4.md` | This record |

### 3.2 Modified

| Path | Change |
|------|--------|
| `packages/shared/package.json` | Subpath export `./adapters/httpAdapter.js`; added `@types/node` |
| `packages/platform/src/server.ts` | Added authenticated `POST /events` for bus publish |

### 3.3 Build artifacts

```
packages/shared/dist/adapters/
├── httpAdapter.js
├── httpAdapter.d.ts
└── httpAdapter.d.ts.map
```

---

## 4. Package export surface

Consumers (Step 7 CLI and agents) import:

```typescript
import { createHttpAdapter, HttpRuntimeAdapter } from '@avp/shared/adapters/httpAdapter.js'
```

Configured in `packages/shared/package.json`:

```json
"exports": {
  ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
  "./adapters/httpAdapter.js": {
    "types": "./dist/adapters/httpAdapter.d.ts",
    "import": "./dist/adapters/httpAdapter.js"
  }
}
```

Root `@avp/shared` remains types-only; the adapter is a **runtime** module (actual JS), so it lives under the subpath export.

---

## 5. What was implemented in `httpAdapter.ts`

### 5.1 `InMemoryWorkingMemory`

Implements `IWorkingMemory`:

- `Map` of `{ v, exp }` with TTL (default 3600s)
- `get` / `set` / `delete`
- Extra `clear()` used by `shutdown()` (avoids the plan’s invalid `this.workingMemory = undefined` assignment on a `readonly` field)

### 5.2 `RemoteEpisodicMemory` (private)

Talks to Platform with Bearer JWT:

| Method | HTTP |
|--------|------|
| `write` | `POST /episodes` |
| `readSimilar` | `GET /episodes/similar?agentId&hash&limit` |
| `linkOutcome` | `PATCH /episodes/:id/outcome` |

Improvements vs plan snippet:

- Checks `res.ok` and throws with Platform error text
- Coerces episode `id` from string → number (pg `BIGSERIAL` often JSON-serializes as string)
- Uses `URLSearchParams` for query encoding

### 5.3 `HttpRuntimeAdapter`

Implements `IRuntimeAdapter`:

| Method | Behavior |
|--------|----------|
| `graphWrite` | `POST /graph/nodes` or `/graph/edges` with capability-scoped JWT |
| `graphRead` | `POST /graph/query` (SELECT only, enforced server-side) |
| `publish` | `POST /events` (non-blocking; swallows network errors) |
| `subscribe` | Local handler map (in-process; full NATS subscribe remains platform-side for now) |
| `health` | Probes `GET /health`; returns `degraded` if shut down or unreachable |
| `shutdown` | Flags shut down, clears handlers + working memory |

**Graph body shaping**: the plan spread the whole `GraphWriteOp` (including `type: 'upsertNode'`) into the JSON body. The adapter now sends only fields the Platform expects (`kind`/`label`/… or `fromId`/`toId`/…) plus `traceId`.

**IDs**: uses `node:crypto.randomUUID()` instead of the `uuid` package (no new runtime dependency on `@avp/shared`).

**Guard**: after `shutdown()`, mutating calls throw.

### 5.4 `createHttpAdapter(platformUrl, manifest)`

1. `POST {platformUrl}/agents/register` with the manifest  
2. Read `{ token }`  
3. Return `new HttpRuntimeAdapter(baseUrl, manifest.id, token, runtime, domain)`  

Trailing slashes on `platformUrl` are stripped.

---

## 6. Platform addition: `POST /events`

Step 4’s `publish()` requires this route. Added to `packages/platform/src/server.ts`:

- **Auth**: Bearer JWT required  
- **Required body fields**: `traceId`, `spanId`, `kind`  
- **Forced from JWT**: `agentId`, `runtime`, `domain` (cannot spoof another agent)  
- **Action**: `bus.publish(event)` → NATS subject `context.{domain}.{kind}`  
- **Response**: `{ published: true, subject, id }`

Example success:

```json
{
  "published": true,
  "subject": "context.build.adapter_probe_ack",
  "id": "efd01a75-3430-4419-b3f9-68dbc29269c2"
}
```

Unauthenticated call returns **401** (verified).

---

## 7. Deviations from the plan snippet (and why)

| Plan | Implemented | Why |
|------|-------------|-----|
| `import { v4 as uuid } from 'uuid'` | `randomUUID` from `node:crypto` | Avoid adding `uuid` to `@avp/shared` for one call |
| Unused `import crypto` | Removed | Dead import |
| `shutdown()` assigns `workingMemory = undefined` | `clear()` + shut-down flag | `readonly` field; safer lifecycle |
| Spread entire `GraphWriteOp` to API | Explicit body mapping | Cleaner contract with Platform handlers |
| Silent fetch errors only | Plus `res.ok` checks on graph/episodes | Fail fast on 401/403/500 |
| No Platform `/events` | Added in Step 4 | Required for `publish()` |
| `health()` always `ok` | Probes Platform `/health` | Useful for CI/runtime readiness |
| Local `subscribe` only | Kept + optional `dispatchLocal` helper | Full remote NATS subscribe can come later; agents still register handlers |

---

## 8. How it was done (commands)

```bash
# Implement adapter + update shared exports + add /events on platform

cd /Users/harig/Desktop/AVP
pnpm install
pnpm -F @avp/shared build
pnpm -F @avp/platform build

# Platform was already running under tsx watch — picked up /events automatically
```

Verification used the compiled dist module:

```bash
node --input-type=module   # script importing ./packages/shared/dist/adapters/httpAdapter.js
```

---

## 9. Verification results

Probe agent: `step4-adapter:v1`  
Capabilities: `SECURITY_SCAN`, `CVE_FINDING` nodes; `EVIDENCED_BY` edges.

| # | Check | Result |
|---|-------|--------|
| 1 | `createHttpAdapter` register + JWT | `agentId: step4-adapter:v1` |
| 2 | `health()` | `{ status: 'ok' }` |
| 3 | Working memory set/get | `{ ok: true }` |
| 4 | `graphWrite` upsertNode | `nodeId: 2` |
| 5 | `graphWrite` insertEdge | `edgeId: 1` |
| 6 | `graphRead` SELECT by ids | Both nodes returned |
| 7 | Episodic write + `readSimilar` | episode id `2`, similar count `1` |
| 8 | `POST /events` via adapter + direct | HTTP **200**, subject `context.build.*` |
| 9 | Unauthorized `CUSTOMER_SIGNAL` write | Throws (403 / capability message) |
| 10 | `shutdown()` then `health()` | `{ status: 'degraded', detail: 'shut down' }` |

**ALL STEP 4 CHECKS PASSED**

---

## 10. How agents will use this (preview of Steps 5–7)

```typescript
import { createHttpAdapter } from '@avp/shared/adapters/httpAdapter.js'
import { VOC_MANIFEST } from './vocIntelligenceAgent.js'

const adapter = await createHttpAdapter(
  process.env.AVP_PLATFORM_URL ?? 'http://localhost:7070',
  VOC_MANIFEST,
)

const result = await adapter.graphWrite({
  type: 'upsertNode',
  kind: 'PAIN_POINT',
  label: 'Bulk dispute filing',
})

await adapter.publish({
  traceId: result.traceId,
  spanId: crypto.randomUUID(),
  runtime: adapter.runtime,
  domain: 'listen',
  kind: 'pain_point_clustered',
  graphDelta: { nodesCreated: [result.nodeId!], edgesCreated: [] },
})
```

`BaseAgent` (Step 5) will wrap these calls so domain agents rarely touch HTTP details.

---

## 11. What this unlocks

| Next step | Unlocked by |
|-----------|-------------|
| **Step 5** — `BaseAgent` | Stable `IRuntimeAdapter` client for all agents |
| **Step 6** — Domain agents | Register + write graph without custom HTTP code |
| **Step 7** — Pipeline CLI | `createHttpAdapter` + agent `run()` in CI |
| **Step 8** — GitHub Actions | Same adapter over `AVP_PLATFORM_URL` secret |

---

## 12. Explicitly out of scope

- `BaseAgent` / domain agent packages (Steps 5–6)
- Remote NATS subscribe from the adapter process (local handler map only)
- Redis-backed working memory inside external runtimes
- Retry/backoff policies beyond non-blocking `publish()`

---

## 13. How to re-verify

```bash
# Platform + infra must be up
curl -sf http://localhost:7070/health

cd /Users/harig/Desktop/AVP
pnpm -F @avp/shared build

node --input-type=module -e "
import { createHttpAdapter } from './packages/shared/dist/adapters/httpAdapter.js'
const a = await createHttpAdapter('http://localhost:7070', {
  id: 'step4-recheck:v1', name: 'Recheck', archetype: 'Test',
  domain: 'build', runtime: 'pipeline', version: '1.0.0',
  capabilities: { nodeKinds: ['SECURITY_SCAN'], edgeKinds: ['EVIDENCED_BY'],
    requiresGate: false, maxWritesPerMinute: 10 },
  subscribes: [], healthEndpoint: ''
})
console.log(await a.health())
console.log(await a.graphWrite({ type: 'upsertNode', kind: 'SECURITY_SCAN', label: 'recheck '+Date.now() }))
await a.shutdown()
"
```

---

## 14. Summary

Step 4 added `HttpRuntimeAdapter` and `createHttpAdapter()` under `@avp/shared/adapters/httpAdapter.js`, wired package exports, and completed the Platform with `POST /events` so `publish()` fans out through NATS. The adapter was verified end-to-end for registration, graph read/write, episodic memory, events, capability denial, and clean shutdown. External agents now have a single, typed client for the AOP API.
