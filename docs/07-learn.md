# Learn phase & closing the loop

## Purpose

Judge whether the bet paid off, capture stakeholder impact, distill lessons, calibrate estimators, and **close the cycle** so the next Listen pass is smarter.

## Sidebar

| Nav | Path | Statuses |
|-----|------|----------|
| Outcomes | `/outcomes` | Needs live metrics · Needs outcomes · Outcomes judged |
| Impact | `/impact` | Needs outcomes first · Needs impact assessment · Impact assessed |
| Lessons | `/lessons` | Needs outcomes · Needs lessons · Lessons captured · **Cycle closed** |

## Agents

| Package | Agent | Writes |
|---------|-------|--------|
| `@avp/agents-learn-attribution-analyst` | AttributionAnalyst | `HYPOTHESIS_VERDICT` → FEATURE (`ATTRIBUTES`), `OUTCOME` |
| `@avp/agents-learn-stakeholder-impact` | StakeholderImpact | `IMPACT_ASSESSMENT`, `SENTIMENT` |
| `@avp/agents-learn-organizational-learning` | OrganizationalLearning | `LEARNING`, `CALIBRATION_RECORD` |
| `@avp/agents-learn-calibration` | Calibration | `CALIBRATION_RECORD`, optional `DRIFT_ALERT` + `/calibration` POST |

## Close the loop

`POST /studio/lessons/:id/close` (Admin/Editor):

1. Captures lessons if missing  
2. Calibrates `value-engineering:v1` predicted vs realized annual value  
3. Sets `feature.metadata.cycleClosed = true`  
4. Sets `cycles.current_stage = 'DONE'`  
5. Writes a loop-back `LEARNING` with `feedsListen: true`  

Home banner: **“N cycles closed — lessons ready for the next Listen pass”** → `/lessons`  
(`GET /studio/loop/closed`)

## Toll.OS seed (already closed)

- Verdict: metering bet held; ~₹9.2M realized vs ~₹9.0M mid  
- Positive concessionaire / MPS commercial / roadside ops sentiment  
- Lesson: fuse RFID+ANPR as **one ₹5 event**  
- Calibration error ~2.2% (no drift alert)

## Lessons detail SQL note

Use `EXISTS` (not `SELECT DISTINCT … ORDER BY created_at`) when listing learnings — Postgres rejects DISTINCT/ORDER BY mismatches.

## Key routes

| Platform | BFF |
|----------|-----|
| `/studio/outcomes…` | `/api/outcomes…` |
| `/studio/impact…` | `/api/impact…` |
| `/studio/lessons…` | `/api/lessons…` |
| `GET /studio/loop/closed` | Home banner |
