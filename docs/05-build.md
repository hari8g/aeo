# Build phase

## Purpose

Record what engineering landed, prove the quality gate, and draft docs — before Ship pipeline artifacts.

## Sidebar

| Nav | Path | Statuses |
|-----|------|----------|
| Implementation | `/build` | Needs implementation · Implementation recorded |
| Quality | `/quality` | Needs quality check · Quality passed · Quality blocked |
| Docs | `/docs` | Needs docs · Docs drafted |

## Agents

| Package | Agent | Writes |
|---------|-------|--------|
| `@avp/agents-build-software-engineering` | SoftwareEngineering | `IMPLEMENTATION_NOTE`, `CODE_FILE` |
| `@avp/agents-build-quality-engineering` | QualityEngineering | `TEST_SUITE`, `TEST_CASE`, `TEST_RUN`, QA `BUILD` |
| `@avp/agents-build-documentation` | Documentation | `DOCUMENTATION`, `CHANGELOG` |

## Soft locks

1. Implementation requires **architecture**  
2. Quality & Docs require an **implementation note**  
3. QA success writes `BUILD` with `metadata.source = quality-engineering` and `VERIFIES` → FEATURE (Ship gate)

## Toll.OS seed

- Files under `packages/tollos/...` (fusion, exceptions, metering)  
- Four fixtures including `meter-anpr-inr-event` — all passed  
- Docs: “Toll.OS MLFF event metering guide” + changelog (₹5 language)

## Key routes

| Platform | BFF |
|----------|-----|
| `GET /studio/build`, `POST …/record` | `/api/build…` |
| `GET /studio/quality`, `POST …/run` | `/api/quality…` |
| `GET /studio/docs`, `POST …/draft` | `/api/docs…` |
