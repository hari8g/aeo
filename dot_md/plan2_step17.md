# Plan 2 — Step 17 Implementation Record

**Date**: 2026-07-16  
**Plan source**: `aop_implementation_plan_p2.md` (STEP 17 — Requirements Analyst Agent)  
**Status**: Complete  

---

## 1. Objective

Implement **Requirements Analyst** (`requirements-analyst:v1`): baseline **USER_STORY** and **ACCEPTANCE_CRITERION** nodes for an admitted feature.

**Aligned in this band (steps 17–20):** **Domain Steward** (`domain-steward:v1`) writes `KPI` / `REGULATION` / `BUSINESS_RULE` (+ `DOMAIN_CONCEPT`) so requirements and later agents share a domain vocabulary.

---

## 2. Files changed

```
packages/agents/define/requirements-analyst/
├── package.json                    # @avp/agents-define-requirements-analyst
└── src/agent.ts

packages/agents/define/domain-steward/   # aligned companion
├── package.json                    # @avp/agents-define-domain-steward
└── src/agent.ts
```

---

## 3. How it was done

| Field | Value |
|-------|--------|
| Package | `@avp/agents-define-requirements-analyst` |
| agentId | `requirements-analyst:v1` |
| Domain / runtime | `define` / `studio` |
| Nodes | `USER_STORY`, `ACCEPTANCE_CRITERION` |
| Edges | `REFINES`, `ACCEPTS` |
| Events | `requirements_baselined` |
| Health | `:7101` |

**Requirements `run()`**

1. Load FEATURE.
2. LLM → stories + criteria (stub defaults on parse fail).
3. Write stories; feature `REFINES` story (direction per implementation).
4. Write ACs; story `ACCEPTS` criterion.
5. Emit baselined event via node writes / episode.

**Domain Steward (aligned):** LLM extract → `DOMAIN_CONCEPT`, `KPI`, `REGULATION`, `BUSINESS_RULE` with `DEFINES` / `RELATES_TO` (`:7102`).

```bash
pnpm -F @avp/agents-define-requirements-analyst build
pnpm -F @avp/agents-define-domain-steward build
```

---

## 4. Verification

| Check | Result |
|-------|--------|
| Both packages build | Pass |
| Story + AC kinds registered | Pass |
| Domain steward KPI/REGULATION/BUSINESS_RULE capabilities | Pass |

---

## 5. Deviations

| Plan | Implemented | Why |
|------|-------------|-----|
| Runtime `engineering`; edges `SPECIFIES`/`DECOMPOSES`; Gherkin ACs | `studio`; `REFINES`/`ACCEPTS`; freer criteria text | Match shared EDGE_KINDS + simpler orchestrator |
| Load brief + BUSINESS_RULE in requirements agent | Feature-first; rules live on domain-steward | Separation of concerns |
| Source file `requirementsAnalystAgent.ts` | `agent.ts` | Package naming consistency |

---

## 6. What this unlocks

| Next | Unlocked by |
|------|-------------|
| **Step 18** — Solutions Architect | Stories as architecture input |
| **Step 19** — QE | Criteria for TEST_* derivation |

---

## 7. Summary

Step 17 baselines USER_STORY + ACCEPTANCE_CRITERION, with domain-steward KPI/REGULATION/BUSINESS_RULE aligned in the same define-domain wave.
