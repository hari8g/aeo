# Plan 2 — Step 12 Implementation Record

**Date**: 2026-07-16  
**Plan source**: `aop_implementation_plan_p2.md` (STEP 12 — Business Case Agent)  
**Status**: Complete  

---

## 1. Objective

Implement **Business Case** (`business-case:v1`): turn pain points into a structured **BRIEF** and **FEATURE**, link with **MOTIVATES**, and emit **`brief_written`** so value/strategy agents can subscribe.

---

## 2. Files changed

```
packages/agents/decide/business-case/
├── package.json                    # @avp/agents-decide-business-case
├── tsconfig.json
└── src/
    ├── businessCaseAgent.ts
    └── index.ts
```

---

## 3. How it was done

| Field | Value |
|-------|--------|
| Package | `@avp/agents-decide-business-case` |
| agentId | `business-case:v1` |
| Domain / runtime | `decide` / `studio` |
| Nodes | `BRIEF`, `FEATURE` |
| Edges | `MOTIVATES`, `DUPLICATE_OF` |
| Events | **`brief_written`**, `feature_created` |
| Subscribes | `context.listen.pain_point_clustered` |
| Health | `:7091` |

**`run(input)`**

1. Hash sorted pain-point labels; read episodic similars for dedupe context.
2. Query existing `FEATURE` rows for duplicate awareness.
3. LLM → intake brief JSON (title, problem, segment, evidence, duplicate flags).
4. Write `BRIEF` (`brief_written`) + `FEATURE` (`feature_created`, stage `INTAKE`).
5. `MOTIVATES`: each pain point → feature; brief → feature. Optional `DUPLICATE_OF`.
6. Episodic memory write.

```bash
pnpm -F @avp/agents-decide-business-case build
```

---

## 4. Verification

| Check | Result |
|-------|--------|
| Package builds | Pass |
| Capabilities include `BRIEF`/`FEATURE`/`MOTIVATES` | Pass |
| Event `brief_written` on BRIEF write | Pass |
| Stub/default parse path when LLM JSON invalid | Pass |

---

## 5. Deviations

| Plan | Implemented | Why |
|------|-------------|-----|
| Health `:7083` | `:7091` | Port map remapped across p2 agents |
| `DUPLICATE_OF` listed but lightly sketched | Implemented when LLM marks duplicate | Stronger dedupe graph |
| `crypto.randomUUID` import style | `randomUUID` from `node:crypto` | ESM consistency with Part 1 |

---

## 6. What this unlocks

| Next | Unlocked by |
|------|-------------|
| **Step 13** — Value Engineering | Subscribes to `brief_written` |
| **Step 14–16** — Strategy / estimate / portfolio | FEATURE + BRIEF graph anchors |

---

## 7. Summary

Step 12 delivered BRIEF+FEATURE intake with MOTIVATES edges and `brief_written`, establishing the decide-domain handoff from listen pain points.
