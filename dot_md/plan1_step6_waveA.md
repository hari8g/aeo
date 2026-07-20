# Plan 1 — Step 6 Wave A

**Status**: Complete  
**Scope**: Shared `graphKinds` + Market Signal agent  

## Delivered

| Item | Path / package |
|------|----------------|
| Graph vocabulary | [`packages/shared/src/graphKinds.ts`](packages/shared/src/graphKinds.ts) (re-exported from `@avp/shared`) |
| Market Signal | `@avp/agents-listen-market-signal` → `packages/agents/listen/market-signal/` |

## Market Signal

- Manifest: `market-signal:v1`, domain `listen`, runtime `studio`
- Nodes: `MARKET_SIGNAL`, `COMPETITOR_MOVE`, `REGULATORY_SIGNAL`
- Edges: `INFORMS`, `THREATENS`, `ENABLES`
- `run()`: classify sources (LLM + stub fallback) → write nodes → optional edges to pain points → episode + `market_signal_ingested`

## Verify

E2E (`scripts/verify-remaining-18.ts`): signalIds `[13,14]`, topThreat from competitor title.
