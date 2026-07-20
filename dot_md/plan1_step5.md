# Plan 1 — Step 5 Implementation Record

**Date**: 2026-07-16  
**Plan source**: `aop_implementation_plan_p1.md` (STEP 5 — Agent base class)  
**Status**: Complete and verified against Platform API on `:7070`  

---

## 1. Objective

Create `@avp/agent-base` — the abstract `BaseAgent` class that every domain agent (Step 6+) extends. It centralizes:

| Helper | Purpose |
|--------|---------|
| `hashInput()` | SHA-256 of input for episodic memory lookup |
| `complete()` | LLM calls with `agentId` attribution |
| `writeNode()` | Graph upsert **plus** context-bus publish |
| `writeEdge()` | Graph edge insert |
| `fail()` | Consistent error wrapping (`agentId/stage: message`) |

Agents supply `agentId` + `domain` and implement their own `run()`; they should not re-implement HTTP/graph/event plumbing.

---

## 2. Starting state

- Steps 1–4 complete (`@avp/shared` types, Docker, Platform API, `HttpRuntimeAdapter`)
- Platform healthy at `http://localhost:7070`
- No `packages/agents/` tree yet
- Workspace globs already include `packages/agents/*` and `packages/agents/**/*`

---

## 3. Files created

```
packages/agents/shared/
├── package.json          # @avp/agent-base
├── tsconfig.json
└── src/
    ├── agentBase.ts      # BaseAgent implementation
    └── index.ts          # public exports

scripts/verify-step5.ts   # E2E probe (concrete subclass)
plan1_step5.md            # this record
```

Build output:

```
packages/agents/shared/dist/
├── index.js / index.d.ts
└── agentBase.js / agentBase.d.ts
```

---

## 4. Package configuration

### 4.1 `package.json`

| Field | Value |
|-------|--------|
| Name | `@avp/agent-base` |
| Type | `module` |
| Export | `.` → `dist/index.js` + types |
| Dependency | `@avp/shared: workspace:*` |
| Scripts | `build` (`tsc`), `clean` |

Conditional exports include `types` + `import` (same pattern as `@avp/shared` / `@avp/platform`).

### 4.2 `tsconfig.json`

- Extends repo `tsconfig.base.json`
- `rootDir: src`, `outDir: dist`
- Project reference to `packages/shared`
- `composite` + declaration/source maps enabled

### 4.3 Workspace discovery

After `pnpm install`, workspace count became **4** projects:

`avp` (root), `@avp/shared`, `@avp/platform`, `@avp/agent-base`

---

## 5. `BaseAgent` API (what was implemented)

### 5.1 Abstract surface

```typescript
export abstract class BaseAgent {
  protected abstract readonly agentId: string
  protected abstract readonly domain: VerbDomain

  constructor(
    protected readonly adapter: IRuntimeAdapter,
    protected readonly llm: ILLMGateway,
  ) {}
}
```

Subclasses inject:

1. An `IRuntimeAdapter` (typically from `createHttpAdapter` — Step 4)
2. An `ILLMGateway` (Platform stub/Anthropic, or a test double)

### 5.2 `hashInput(input)`

```typescript
createHash('sha256').update(JSON.stringify(input)).digest('hex')
```

Used by domain agents before `episodicMemory.readSimilar(...)`.

### 5.3 `complete(req)`

Forwards to `this.llm.complete({ ...req, agentId: this.agentId })` so token usage is always attributed.

### 5.4 `writeNode(params)`

1. `adapter.graphWrite({ type: 'upsertNode', ... })`
2. `adapter.publish({ kind: eventKind, graphDelta.nodesCreated: [nodeId], ... })`
3. Returns `nodeId`

`WriteNodeParams` is exported for subclass typing:

- `kind`, `label`, optional `description` / `metadata`
- required `eventKind` (bus event name)
- optional `cycleId` / `featureId`

Errors from the Platform are rethrown via `fail('writeNode', err)`.

### 5.5 `writeEdge(fromId, toId, kind, weight?, metadata?)`

Calls `adapter.graphWrite({ type: 'insertEdge', ... })`, returns optional `edgeId`, wraps failures with `fail('writeEdge', ...)`.

### 5.6 `fail(stage, err)`

Logs `[agentId] Error in stage: …` and throws `Error: agentId/stage: …`.

---

## 6. Deviations from the plan snippet (and why)

| Plan | Implemented | Why |
|------|-------------|-----|
| `import { v4 as uuid } from 'uuid'` | `randomUUID` from `node:crypto` | No extra dependency; matches Step 4 |
| `import crypto from 'node:crypto'` then `crypto.createHash` | Named `createHash` import | Clearer ESM style |
| Bare `exports: { ".": "./dist/index.js" }` | Types + import conditional exports | Correct TS/Node resolution |
| No `index.ts` | Barrel `export { BaseAgent, type WriteNodeParams }` | Clean package entry |
| `writeEdge` returns `void` | Returns `edgeId?: number` | Useful for callers/tests |
| No try/fail around writes | `writeNode` / `writeEdge` use `fail()` | Consistent agent-scoped errors |
| No verify script | `scripts/verify-step5.ts` | Reproducible E2E check |

Behavioral contract matches the plan: hash → complete → writeNode (graph+event) → writeEdge → fail.

---

## 7. How it was done (commands)

```bash
cd /Users/harig/Desktop/AVP

# Created packages/agents/shared/{package.json,tsconfig.json,src/*}

pnpm install
pnpm -F @avp/shared build
pnpm -F @avp/agent-base build

# E2E (requires Platform on :7070)
pnpm -F @avp/platform exec tsx ../../scripts/verify-step5.ts
```

---

## 8. Verification results

Probe agent: `step5-probe:v1` (concrete subclass of `BaseAgent`)  
Adapter: `createHttpAdapter` → Platform  
LLM: in-process stub implementing `ILLMGateway`

| # | Check | Result |
|---|-------|--------|
| 1 | `hashInput` deterministic | `true` |
| 2 | `run()` → `complete` + `writeNode` ×2 + `writeEdge` + episode | `scanId: 4`, `findingId: 5`, `edgeId: 2`, stub text includes agent id |
| 3 | Graph SELECT both nodes | `SECURITY_SCAN` + `CVE_FINDING` present |
| 4 | Episodic `readSimilar` by hash | count `1` |
| 5 | `fail('probe', …)` | throws `step5-probe:v1/probe: intentional` |
| 6 | Unauthorized `CUSTOMER_SIGNAL` via `writeNode` | throws `…/writeNode: [Platform API] 403: … may not write CUSTOMER_SIGNAL` |

**ALL STEP 5 CHECKS PASSED**

---

## 9. How domain agents will use this (Step 6 preview)

```typescript
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'

export class VoCIntelligenceAgent extends BaseAgent {
  protected readonly agentId = 'voc-intelligence:v1'
  protected readonly domain = 'listen' as const

  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) {
    super(adapter, llm)
  }

  async run(input: { signals: unknown[]; cycleId?: string }) {
    const inputHash = this.hashInput(input.signals)
    // ... complete() / writeNode() / writeEdge() / episodicMemory ...
  }
}
```

Registration still happens outside the base class via `createHttpAdapter(url, MANIFEST)`.

---

## 10. What this unlocks

| Next step | Unlocked by |
|-----------|-------------|
| **Step 6** — VoC / DevSecOps / remaining agents | Shared write/LLM/error helpers |
| **Step 7** — Pipeline CLI | Agents extend `BaseAgent`, CLI wires adapter + LLM |
| Calibration / learn agents | Same `hashInput` + episodic patterns |

---

## 11. Explicitly out of scope

- Concrete domain agents (Step 6)
- Pipeline CLI (Step 7)
- Mapping Postgres snake_case episode columns → camelCase in the adapter (pre-existing; episode **count** verified)
- Human gate enforcement beyond JWT `requiresGate` claim (platform concern)

---

## 12. How to re-verify

```bash
# Platform must be up
curl -sf http://localhost:7070/health

cd /Users/harig/Desktop/AVP
pnpm -F @avp/agent-base build
pnpm -F @avp/platform exec tsx ../../scripts/verify-step5.ts
```

---

## 13. Summary

Step 5 delivered `@avp/agent-base` with an abstract `BaseAgent` that standardizes input hashing, LLM attribution, graph node/edge writes with context events, and error wrapping. The package builds cleanly and was verified end-to-end through a concrete probe subclass against the live Platform API. Domain agents in Step 6 can now extend this class instead of reimplementing platform plumbing.
