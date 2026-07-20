# Architecture

## Overview

AEO splits into three runtime concerns:

```
┌─────────────────┐     X-Studio-Secret      ┌──────────────────┐
│  studio-web     │ ───────────────────────► │  platform (:7070) │
│  Next.js :3001  │ ◄─── JSON boards/CTAs ── │  Fastify + graph  │
└─────────────────┘                          └────────┬─────────┘
                                                      │
                          createHttpAdapter + LLM     │
                                                      ▼
                                            ┌──────────────────┐
                                            │  agents/*        │
                                            │  write nodes/   │
                                            │  edges + events │
                                            └──────────────────┘
```

## Graph model

- **Nodes** (`graph_nodes`): typed artifacts (`FEATURE`, `USER_STORY`, `BOUNDED_CONTEXT`, `BUILD`, `OUTCOME`, …)  
- **Edges** (`graph_edges`): typed relations (`REFINES`, `IMPLEMENTS`, `VERIFIES`, `ATTRIBUTES`, …)  
- **Cycles** (`cycles`): per-feature lifecycle stage (`SIGNALS` → … → `DONE`)  
- **Calibration** (`agent_calibration`): predicted vs actual for estimator agents  

Canonical kind enums live in `packages/shared` (`NODE_KINDS`, `EDGE_KINDS`).

## Cycle orchestrator

`packages/platform/src/orchestrator/cycleOrchestrator.ts` advances stages when predicates hold:

| Stage | Domain | Advances when |
|-------|--------|---------------|
| BUILD | build | QA `BUILD` with `conclusion=success` |
| CONSOLIDATE | ship | `READINESS_REPORT.ready` |
| RELEASE_GATE | ship | Required roles signed `RELEASE_GATE` |
| ROLLOUT | ship | `DEPLOYMENT` status `deployed` |
| OBSERVE | ship | Enough `KPI_OBSERVATION`s |
| LEARN | learn | Any `OUTCOME` |
| DONE | learn | Terminal |

Closing the loop from Studio sets `cycles.current_stage = 'DONE'` and `feature.metadata.cycleClosed = true`.

## Studio route registration

- Decide / Define / Build: `packages/platform/src/studio/studioRoutes.ts`  
- Ship / Learn: `packages/platform/src/studio/shipLearnRoutes.ts` (registered from `registerStudioRoutes`)  

Next.js BFF under `packages/studio-web/app/api/**` proxies with session RBAC.

## Security notes

- Never commit `.env` / `.env.local`  
- Dev secret: `STUDIO_SECRET=avp-studio-dev-secret`  
- LLM stub runs without `ANTHROPIC_API_KEY`; agents still write fallback graph nodes  
