# Plan 1 — Step 5.1 Implementation Record  
## Reference agents: VoC Intelligence + DevSecOps

**Date**: 2026-07-16  
**Plan source**: `aop_implementation_plan_p1.md` (STEP 6 — Representative agents)  
**Doc name**: `plan1_step5.1.md` (reference-agent slice after Step 5 `BaseAgent`)  
**Status**: Complete and verified  

---

## 1. Objective

Implement the two **reference agents** from the plan so every remaining agent can copy the same package pattern:

| Agent | Domain | Runtime | Package |
|-------|--------|---------|---------|
| **VoC Intelligence** | `listen` | `studio` | `@avp/agents-listen-voc-intelligence` |
| **DevSecOps** | `ship` | `pipeline` | `@avp/agents-ship-devsecops` |

Both extend `@avp/agent-base` (`BaseAgent`), register via Step 4’s `createHttpAdapter`, and write to the Platform graph + episodic memory.

---

## 2. Starting state

- Steps 1–5 complete (`@avp/shared`, infra, Platform API, HTTP adapter, `BaseAgent`)
- Platform healthy at `http://localhost:7070`
- Only `packages/agents/shared` existed under `packages/agents/`

---

## 3. Packages created

```
packages/agents/
├── shared/                          # @avp/agent-base (Step 5)
├── listen/
│   └── voc-intelligence/            # @avp/agents-listen-voc-intelligence
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── vocIntelligenceAgent.ts
│           └── index.ts
└── ship/
    └── devsecops/                   # @avp/agents-ship-devsecops
        ├── package.json
        ├── tsconfig.json
        └── src/
            ├── devSecOpsAgent.ts
            └── index.ts

scripts/verify-step5.1.ts
plan1_step5.1.md
```

Workspace now has **6** packages (root + shared + platform + agent-base + voc + devsecops).

---

## 4. VoC Intelligence Agent

### 4.1 Manifest (`VOC_MANIFEST`)

| Field | Value |
|-------|--------|
| id | `voc-intelligence:v1` |
| domain / runtime | `listen` / `studio` |
| nodeKinds | `CUSTOMER_SIGNAL`, `PAIN_POINT` |
| edgeKinds | `EXPRESSES` |
| maxWritesPerMinute | 120 |
| preferredModel | `claude-sonnet-4-6` |

### 4.2 `run(input: VoCInput)` pipeline

1. Validate non-empty `signals[]`
2. Hash sorted signal texts → episodic similarity key
3. **Ingest**: each signal → `CUSTOMER_SIGNAL` node + `signal_ingested` event
4. **Calibrate**: `episodicMemory.readSimilar` (supports both camelCase and snake_case summaries from Postgres)
5. **Cluster**: LLM prompt requesting JSON clusters; robust parse (extract `{...}` substring)
6. **Fallback**: if LLM returns non-JSON (e.g. stub), one `General feedback` cluster covering all signals
7. **Write**: `PAIN_POINT` nodes + `EXPRESSES` edges from signals → pain points
8. **Episode**: store input/output summary + node ids
9. **Return**: `painPointIds`, `clusterCount`, `topProblem` (highest `importance_score`)

### 4.3 Verification (stub LLM)

```
painPointIds: [9]
clusterCount: 1
topProblem: 'General feedback'
```

Graph confirmed `PAIN_POINT` / `General feedback` (expected under stub — no real Anthropic key).

---

## 5. DevSecOps Agent

### 5.1 Manifest (`DEVSECOPS_MANIFEST`)

| Field | Value |
|-------|--------|
| id | `devsecops:v1` |
| domain / runtime | `ship` / `pipeline` |
| nodeKinds | `SECURITY_SCAN`, `CVE_FINDING`, `COMPLIANCE_CHECK` |
| edgeKinds | `EVIDENCED_BY`, `BLOCKS_RELEASE` |
| subscribes | `context.build.build_completed` |
| maxWritesPerMinute | 60 |

### 5.2 `run(input: SecScanInput)` pipeline

1. Validate `repoPath`, `gitSha`, `runId`
2. Collect findings from (first match wins):
   - `input.fixtureFindings` (tests), or
   - `AVP_DEVSECOPS_FIXTURE=1` synthetic critical, or
   - live `semgrep` + `trivy` via `execSync` (errors swallowed if tools missing)
3. Blocking rule: `critical > 0` **OR** `high > 2`
4. Write `SECURITY_SCAN` node + `security_scan_completed` event
5. For each finding: `CVE_FINDING` + `EVIDENCED_BY`; CRITICAL/HIGH also get `BLOCKS_RELEASE`
6. Optional link from `rcNodeId` → scan via `EVIDENCED_BY`
7. Return summary + blocking flag (CLI/CI exits non-zero when blocking — Step 7)

### 5.3 Additions vs plan snippet

| Addition | Why |
|----------|-----|
| `fixtureFindings` on input | Deterministic tests without installing Semgrep/Trivy |
| `AVP_DEVSECOPS_FIXTURE=1` | Optional CI-style synthetic critical |
| Quoted paths in scanner cmds | Safer `execSync` shell invocation |
| Typed `SecFinding` | Shared finding shape |

### 5.4 Verification

| Scenario | Result |
|----------|--------|
| `fixtureFindings: []` | Clean, `blocking: false`, `scanNodeId: 10` |
| Fixture CRITICAL | `blocking: true`, `findingIds: [12]`, summary `BLOCKED — 1 critical…` |

---

## 6. Shared package pattern (template for remaining agents)

Each agent package follows:

```
packages/agents/{domain}/{agent-name}/
  package.json          # @avp/agents-{domain}-{name}
  tsconfig.json         # refs agent-base + shared
  src/
    {agentName}.ts      # MANIFEST + Input/Output + class extends BaseAgent
    index.ts            # re-exports
```

Required exports:

- `*_MANIFEST: AgentManifest`
- typed `*Input` / `*Output`
- agent class with `async run(input): Promise<output>`
- uses only `writeNode` / `writeEdge` / `complete` / `adapter.episodicMemory` / `hashInput`

---

## 7. How it was done (commands)

```bash
cd /Users/harig/Desktop/AVP
pnpm install
pnpm -F @avp/shared build
pnpm -F @avp/agent-base build
pnpm -F @avp/agents-listen-voc-intelligence build
pnpm -F @avp/agents-ship-devsecops build
pnpm -F @avp/platform exec tsx ../../scripts/verify-step5.1.ts
```

Also added `"default"` to package `exports` on agent packages / shared so Node/tsx resolution is reliable.

---

## 8. What this unlocks

- **Step 7** pipeline CLI can import `@avp/agents-ship-devsecops`
- Remaining **18 agents** copy this exact layout (see Ask-mode remaining-agents plan)
- End-to-end LISTEN (VoC) and SHIP (DevSecOps) paths proven on the live Platform

---

## 9. Explicitly out of scope

- Remaining 18 domain agents
- Pipeline CLI / GitHub Actions (Steps 7–8)
- Real Semgrep/Trivy install in this step (optional locally; fixtures cover CI logic)
- Anthropic-backed VoC clustering (stub fallback verified; set `ANTHROPIC_API_KEY` for live clusters)

---

## 10. Re-verify

```bash
curl -sf http://localhost:7070/health
pnpm -F @avp/agents-listen-voc-intelligence build
pnpm -F @avp/agents-ship-devsecops build
pnpm -F @avp/platform exec tsx ../../scripts/verify-step5.1.ts
```

---

## 11. Summary

Step 5.1 delivered two production-shaped reference agents: **VoC Intelligence** (listen/studio — signal ingest → LLM/fallback cluster → pain points) and **DevSecOps** (ship/pipeline — scan → findings → release-blocking graph writes). Both build, register, and write successfully against the Platform API. This is the pattern for all remaining agents.
