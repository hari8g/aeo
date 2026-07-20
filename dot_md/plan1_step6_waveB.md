# Plan 1 — Step 6 Wave B

**Status**: Complete  
**Scope**: 5 Decide agents + `PATCH /cycles/:id`  

## Agents

| Package | Id | Gate |
|---------|-----|------|
| `@avp/agents-decide-business-case` | `business-case:v1` | no |
| `@avp/agents-decide-value-engineering` | `value-engineering:v1` | no |
| `@avp/agents-decide-product-strategy` | `product-strategy:v1` | no |
| `@avp/agents-decide-solutions-estimation` | `solutions-estimation:v1` | no |
| `@avp/agents-decide-portfolio-management` | `portfolio-management:v1` | **yes** (`approvedBy` / `gateToken` / `AVP_GATE_BYPASS=1`) |

## Platform

- `PATCH /cycles/:id` — updates `current_stage`, `feature_id`, `status`, `metadata`, `label`

## Exit criteria

E2E produced gated `FEATURE` node (`featureId: 27`) after business case → value model → hypothesis → estimate → portfolio approve.
