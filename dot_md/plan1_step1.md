# Plan 1 — Step 1 Implementation Record

**Date**: 2026-07-16  
**Plan source**: `aop_implementation_plan_p1.md` (STEP 1 — Shared types package)  
**Status**: Complete and verified  

---

## 1. Objective

Establish the foundational TypeScript contract package `@avp/shared` that every other AVP package will import. This step defines the shared vocabulary for:

- Which **runtimes** agents run in
- Which **value-stream domains** they belong to
- How agents **register** (manifests) and are **authorized** (JWT claims)
- How agents communicate via the **context bus**
- How they read/write the **knowledge graph**
- How they use **working / episodic memory**
- How they call the **LLM gateway**

No runtime services (Postgres, Redis, NATS, Platform API) were started in this step. Step 1 is types-and-build only.

---

## 2. Starting state

The workspace at `/Users/harig/Desktop/AVP` contained only:

```
aop_implementation_plan_p1.md
```

There was no git repo, no `package.json`, no `packages/` tree, and no TypeScript toolchain configured for AVP.

**Toolchain available on the machine** (used as-is):

| Tool | Version | Path |
|------|---------|------|
| Node.js | v20.20.2 | `/Users/harig/.nvm/versions/node/v20.20.2/bin/node` |
| pnpm | 9.15.9 | `/Users/harig/.nvm/versions/node/v20.20.2/bin/pnpm` |

---

## 3. Prerequisite: monorepo bootstrap (required for Step 1)

Step 1 in the plan assumes a pnpm workspace already exists. Because the workspace was empty, a **minimal repository bootstrap** was performed first so `@avp/shared` could be installed and built as a workspace package. This is not Step 2 (Docker) or Step 3 (Platform API); it is only the scaffolding Step 1 depends on.

### 3.1 Root `package.json`

**File**: `/Users/harig/Desktop/AVP/package.json`

Created a private root package named `avp` with:

- Scripts reserved for later steps (`dev`, `build`, `test`, `db:migrate`)
- Root `devDependencies`: `turbo`, `typescript`, `@types/node`

These match the plan’s bootstrap block. Turbo is installed for future multi-package builds; Step 1 itself builds with `tsc` inside `@avp/shared`.

### 3.2 `pnpm-workspace.yaml`

**File**: `/Users/harig/Desktop/AVP/pnpm-workspace.yaml`

```yaml
packages:
  - 'packages/*'
  - 'packages/agents/*'
  - 'packages/agents/**/*'
  - 'packages/runtimes/*'
```

This globs future agent and runtime packages. For Step 1, only `packages/shared` exists and is discovered via `packages/*`.

### 3.3 `tsconfig.base.json`

**File**: `/Users/harig/Desktop/AVP/tsconfig.base.json`

Shared compiler defaults for all packages:

| Option | Value | Why |
|--------|-------|-----|
| `target` | `ES2022` | Modern Node baseline |
| `module` / `moduleResolution` | `NodeNext` | Native ESM + correct `.js` import resolution |
| `strict` | `true` | Enforce type safety across agents/platform |
| `declaration` | `true` | Emit `.d.ts` so consumers get types |
| `outDir` | `dist` | Default build output (overridden per package as needed) |
| `esModuleInterop` / `skipLibCheck` | `true` | Interop + faster builds |

### 3.4 `.gitignore`

**File**: `/Users/harig/Desktop/AVP/.gitignore`

Ignores `node_modules/`, `dist/`, Turbo cache, env files, logs, and future `~/.avp`-style local key dirs (`.avp/`).

### 3.5 Workspace layout note

The plan’s bootstrap snippet uses `mkdir avp && cd avp`. Here the existing Cursor workspace **is** the AVP root (`/Users/harig/Desktop/AVP`), so files were created **in place** rather than nesting a second `avp/` directory.

---

## 4. What was implemented for Step 1

### 4.1 Package scaffold

| Path | Purpose |
|------|---------|
| `packages/shared/package.json` | Package identity, ESM exports, build script |
| `packages/shared/tsconfig.json` | Package-local TS config extending the base |
| `packages/shared/src/index.ts` | All shared types and interfaces (single entrypoint) |

Directory created:

```
packages/shared/
├── package.json
├── tsconfig.json
├── src/
│   └── index.ts
└── dist/                  # produced by `pnpm -F @avp/shared build`
    ├── index.js
    ├── index.d.ts
    └── index.d.ts.map
```

### 4.2 `packages/shared/package.json` details

```json
{
  "name": "@avp/shared",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
```

**How this differs slightly from the plan (and why):**

| Plan | Implemented | Reason |
|------|-------------|--------|
| `"exports": { ".": "./dist/index.js" }` | Conditional exports with `types` + `import` | Lets TypeScript and Node resolve types and ESM correctly without consumers guessing |
| (none) | `"main"` / `"types"` / `"files"` | Standard publish/consume metadata |
| (none) | `"clean"` script | Easy rebuild hygiene |
| (implicit root TS) | Local `typescript` devDependency | Package can build in isolation |

### 4.3 `packages/shared/tsconfig.json` details

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true,
    "declarationMap": true
  },
  "include": ["src/**/*"]
}
```

- `extends` reuses the monorepo base settings.
- `rootDir` / `outDir` map `src/` → `dist/`.
- `composite` prepares for project references when platform/agents are added.
- `declarationMap` emits `.d.ts.map` for better IDE “Go to Definition” into source.

### 4.4 Type surface in `src/index.ts`

All exports from `@avp/shared` are declared in one file. They are **types and interfaces only** (no runtime values), so the compiled `dist/index.js` is effectively empty while `dist/index.d.ts` carries the full contract.

#### 4.4.1 Runtime identifiers — `RuntimeId`

```typescript
export type RuntimeId =
  | 'studio' | 'engineering' | 'pipeline'
  | 'observability' | 'collaboration' | 'worker'
```

Maps to the six planned host surfaces (Studio UI, IDE extension, CI CLI, observability sidecar, Slack bot, background workers).

#### 4.4.2 Domain verbs — `VerbDomain`

```typescript
export type VerbDomain = 'listen' | 'decide' | 'define' | 'build' | 'ship' | 'learn'
```

Value-stream stages used for agent classification, event subjects (`context.{domain}.{kind}`), and JWT claims.

#### 4.4.3 Agent registration — `AgentManifest`

Submitted to `POST /agents/register` in later steps. Encodes:

- Identity: `id`, `name`, `archetype`, `version`
- Placement: `domain`, `runtime`
- Capabilities: allowed `nodeKinds` / `edgeKinds`, `requiresGate`, `maxWritesPerMinute`
- Bus: `subscribes` topic patterns
- Ops: `healthEndpoint`
- Optional LLM budget: `maxTokensPerRun`, `preferredModel`

#### 4.4.4 Auth claims — `AgentJwtPayload`

Shape of the RS256 JWT the platform will issue from a manifest. Capability fields (`nodeKinds`, `edgeKinds`, `requiresGate`, `maxWritesPerMinute`) become enforceable claims for graph writes.

#### 4.4.5 Context bus — `AgentContextEvent`

Cross-agent event envelope with:

- Correlation: `id`, `traceId`, `spanId`, `ts`
- Provenance: `agentId`, `runtime`, `domain`
- Semantics: `kind` (e.g. `security_scan_completed`)
- Graph delta: `nodesCreated` / `edgesCreated` IDs
- Optional cycle/feature linkage and free-form `metadata`

#### 4.4.6 Graph ops — `GraphWriteOp` / `GraphWriteResult`

Discriminated union:

- `upsertNode` — create/update a graph node
- `insertEdge` — create a typed edge between node IDs

`GraphWriteResult` returns optional `nodeId`/`edgeId` plus `agentId`, `traceId`, `ts`.

#### 4.4.7 Memory + adapter contracts

| Symbol | Role |
|--------|------|
| `IWorkingMemory` | Short-TTL key/value store per agent session |
| `EpisodeRecord` | One agent run’s inputs/outputs/tokens for learning |
| `IEpisodicMemory` | Persist episodes, find similar by `inputHash`, link outcomes |
| `IRuntimeAdapter` | Full agent↔platform API: graph, bus, memory, health, shutdown |

`IRuntimeAdapter` is the central seam Step 4’s HTTP adapter and Step 5’s `BaseAgent` will implement/consume.

#### 4.4.8 LLM gateway — `LLMProvider`, `LLMRequest`, `LLMResponse`, `ILLMGateway`

Provider-agnostic completion API. Requests always carry `agentId` for attribution/budgeting. Responses include token usage and a `cached` flag for future caching layers.

---

## 5. How it was done (commands and order)

Executed from `/Users/harig/Desktop/AVP`:

### 5.1 Create files

1. Wrote root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`
2. Wrote `packages/shared/package.json`
3. Wrote `packages/shared/tsconfig.json`
4. Wrote `packages/shared/src/index.ts` with the full type contract from the plan

### 5.2 Install dependencies

```bash
pnpm install
```

**Result:**

- Scope: 2 workspace projects (root + `@avp/shared`)
- Root installed: `typescript@5.9.3`, `turbo@2.10.5`, `@types/node@20.19.43`
- Duration: ~36s
- Lockfile created: `pnpm-lock.yaml`

### 5.3 Build the shared package

```bash
pnpm -F @avp/shared build
```

Invokes `tsc` using `packages/shared/tsconfig.json`.

**Emit:**

| Artifact | Role |
|----------|------|
| `dist/index.js` | ESM module (empty of values; types erased) |
| `dist/index.d.ts` | Public TypeScript API for all consumers |
| `dist/index.d.ts.map` | Source maps for declarations |

### 5.4 Verification

1. Confirmed `dist/` artifacts exist.
2. Confirmed `index.d.ts` begins with `RuntimeId` and `VerbDomain` and includes all planned interfaces.
3. Loaded the ESM entry at runtime:

```bash
node --input-type=module -e \
  "import * as shared from './packages/shared/dist/index.js'; \
   console.log('module loaded OK')"
```

Result: **module loaded OK** (runtime export object empty, as expected for a types-only package).

Build exit code: **0**.

---

## 6. Final tree (relevant to Step 1)

```
AVP/
├── aop_implementation_plan_p1.md
├── plan1_step1.md                 # this document
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── .gitignore
└── packages/
    └── shared/
        ├── package.json
        ├── tsconfig.json
        ├── src/
        │   └── index.ts
        └── dist/
            ├── index.js
            ├── index.d.ts
            └── index.d.ts.map
```

---

## 7. Export checklist (completeness vs plan)

| Export | Present in `src/index.ts` | Present in `dist/index.d.ts` |
|--------|---------------------------|------------------------------|
| `RuntimeId` | Yes | Yes |
| `VerbDomain` | Yes | Yes |
| `AgentManifest` | Yes | Yes |
| `AgentJwtPayload` | Yes | Yes |
| `AgentContextEvent` | Yes | Yes |
| `GraphWriteOp` | Yes | Yes |
| `GraphWriteResult` | Yes | Yes |
| `IWorkingMemory` | Yes | Yes |
| `EpisodeRecord` | Yes | Yes |
| `IEpisodicMemory` | Yes | Yes |
| `IRuntimeAdapter` | Yes | Yes |
| `LLMProvider` | Yes | Yes |
| `LLMRequest` | Yes | Yes |
| `LLMResponse` | Yes | Yes |
| `ILLMGateway` | Yes | Yes |

All Step 1 plan types are implemented. No adapters under `packages/shared/src/adapters/` yet — that is **Step 4**.

---

## 8. How other packages will consume this

Once platform/agents exist:

```typescript
import type {
  AgentManifest,
  IRuntimeAdapter,
  GraphWriteOp,
  VerbDomain,
} from '@avp/shared'
```

Workspace dependency declaration (future packages):

```json
{
  "dependencies": {
    "@avp/shared": "workspace:*"
  }
}
```

Consumers must depend on the **built** `dist/` (or run `pnpm -F @avp/shared build` before typechecking dependents).

---

## 9. What this unlocks

With Step 1 complete, the following can proceed without renegotiating contracts:

| Next step | Unlocked by |
|-----------|-------------|
| **Step 2** — Docker Compose infra | Independent of types; can start in parallel |
| **Step 3** — Platform API | Uses `AgentManifest`, `AgentJwtPayload`, `GraphWriteOp`, bus/memory/LLM interfaces |
| **Step 4** — HTTP runtime adapter | Implements `IRuntimeAdapter`, `IWorkingMemory`, `IEpisodicMemory` |
| **Step 5** — `BaseAgent` | Depends on `IRuntimeAdapter` + `ILLMGateway` |
| **Step 6+** — Individual agents | Each exports an `AgentManifest` typed from `@avp/shared` |

---

## 10. Explicitly out of scope for this step

Not created yet (by design):

- Docker Compose / Postgres / Redis / NATS (Step 2)
- Platform API server (Step 3)
- `HttpRuntimeAdapter` (Step 4)
- Agent packages or `BaseAgent` (Steps 5–6)
- Pipeline CLI / GitHub Actions (Steps 7–8)
- Git init / initial commit (not requested)

---

## 11. How to re-verify locally

```bash
cd /Users/harig/Desktop/AVP
pnpm install
pnpm -F @avp/shared clean   # optional
pnpm -F @avp/shared build
ls packages/shared/dist/
# Expect: index.js  index.d.ts  index.d.ts.map
```

---

## 12. Summary

Step 1 delivered a buildable `@avp/shared` package containing the complete AVP type contract, plus the minimal monorepo scaffolding required to install and compile it. The package builds cleanly with TypeScript (`tsc` exit 0), emits declaration files for all planned exports, and is ready for Platform API and agent packages to depend on via `workspace:*`.
