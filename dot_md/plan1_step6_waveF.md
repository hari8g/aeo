# Plan 1 — Step 6 Wave F

**Status**: Complete  
**Scope**: Learn agents + `POST /calibration`  

| Package | Id | Runtime |
|---------|-----|---------|
| `@avp/agents-learn-attribution-analyst` | `attribution-analyst:v1` | studio |
| `@avp/agents-learn-stakeholder-impact` | `stakeholder-impact:v1` | collaboration |
| `@avp/agents-learn-organizational-learning` | `organizational-learning:v1` | worker |
| `@avp/agents-learn-calibration` | `calibration:v1` | worker |

## Platform

- `POST /calibration` — inserts `agent_calibration` row (`agent_id`, `cycle_id`, predicted/actual, `error_pct`, `kpi`)

## Exit criteria

E2E: verdict + outcomes, stakeholder impact/sentiment, lessons/playbook updates, calibration node with `errorPct: 37.5` and DB row via Platform.

## Full-stream verifier

```bash
pnpm -F @avp/platform exec tsx ../../scripts/verify-remaining-18.ts
```

Result: **ALL REMAINING-18 AGENT CHECKS PASSED**
