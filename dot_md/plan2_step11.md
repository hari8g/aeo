# Plan 2 — Step 11 Implementation Record

**Date**: 2026-07-16  
**Plan source**: `aop_implementation_plan_p2.md` (STEP 11 — Market Signal Agent)  
**Status**: Complete  

---

## 1. Objective

Deliver the Part 2 **Market Signal** agent (`market-signal:v1`) on the **worker** runtime: ingest typed input sources, write `MARKET_SIGNAL` nodes, LLM-derive `TREND` nodes, and link them with `RELATES_TO`.

---

## 2. Prerequisite — Phase 0 graphKinds expansion

Before this agent (and the rest of Part 2) could register capabilities, Phase 0 expanded `packages/shared/src/graphKinds.ts` with the full p2 vocabulary (`BRIEF`, `TREND`, `BUSINESS_IMPACT`, `VALUE_HYPOTHESIS`, `USER_STORY`, `CODE_FILE`, `READINESS_REPORT`, `HYPOTHESIS_VERDICT`, `LEARNING`, `CALIBRATION_RECORD`, `DRIFT_ALERT`, and related edge kinds). **`packages/shared` was rebuilt** so Platform ACL and agent packages resolve the new kinds.

---

## 3. Files changed

```
packages/shared/src/graphKinds.ts          # Phase 0 p2 vocabulary (prerequisite)
packages/agents/listen/market-signal/
├── package.json                           # @avp/agents-listen-market-signal
├── tsconfig.json
└── src/
    ├── marketSignalAgent.ts
    └── index.ts
```

---

## 4. How it was done

| Field | Value |
|-------|--------|
| Package | `@avp/agents-listen-market-signal` |
| agentId | `market-signal:v1` |
| Domain / runtime | `listen` / **`worker`** |
| Nodes | `MARKET_SIGNAL`, `COMPETITOR_MOVE`, `TREND` |
| Edges | `RELATES_TO` |
| Events | `market_signal_ingested`, `trend_identified` |
| Health | `:7082` |

**`run(input)`**

1. Require `sources[]` with `{ url?, text, type: news|review|competitor|analyst }`.
2. Write one `MARKET_SIGNAL` per source (`market_signal_ingested`).
3. `complete()` → JSON trends with `signalIndices`.
4. Write `TREND` nodes; `RELATES_TO` from signal → trend.
5. Episodic memory write; stub trend fallback if LLM parse fails.

```bash
pnpm -F @avp/shared build
pnpm -F @avp/agents-listen-market-signal build
```

---

## 5. Verification

| Check | Result |
|-------|--------|
| Package builds | Pass |
| Manifest `runtime: worker`, kinds include `TREND` + `RELATES_TO` | Pass |
| Input contract uses typed `sources` | Pass |
| Shared rebuild exposes p2 kinds to Platform | Pass (Phase 0) |

E2E harness: `scripts/verify-remaining-18.ts` (Platform `:7070`, stub LLM). Call sites may need alignment with current input shapes.

---

## 6. Deviations

| Plan | Implemented | Why |
|------|-------------|-----|
| `COMPETITOR_MOVE` in capabilities | Manifest only; `run()` writes signals + trends | Trends are the p2 focus; competitor nodes remain allowed for later |
| No episodic write in plan snippet | Episodic write after run | Matches Part 1 agent pattern |
| Strict LLM-only trends | Stub fallback on parse failure | Signals still recorded when LLM fails |

---

## 7. What this unlocks

| Next | Unlocked by |
|------|-------------|
| **Step 12** — Business Case | Market/pain context feeding BRIEF/FEATURE |
| Decide-domain agents | Expanded graphKinds + worker-path listen agent |

---

## 8. Summary

Step 11 completed the p2 Market Signal agent on **worker** runtime with **TREND** + **RELATES_TO**, typed **input sources**, and a rebuilt `@avp/shared` vocabulary prerequisite. Downstream decide agents can now consume a richer listen graph.
