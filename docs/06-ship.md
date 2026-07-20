# Ship phase

## Purpose

Promote a quality-passed feature through CI, security/cost clearance, release readiness, and live rollout health.

## Sidebar

| Nav | Path | Typical statuses |
|-----|------|------------------|
| Builds | `/builds` | Needs quality pass · Needs pipeline build · Build recorded |
| Safety | `/safety` | Needs pipeline build · Needs safety checks · Safety cleared / blocked |
| Release | `/release` | Needs readiness · Awaiting sign-off · Release approved |
| Rollout | `/rollout` | Needs rollout · Deployed — watch metrics · Healthy in production |

## Agents

| Package | Agent |
|---------|-------|
| `@avp/agents-ship-devops` | Pipeline `BUILD` + `IAC_CHANGESET` |
| `@avp/agents-ship-devsecops` | `SECURITY_SCAN` + `CVE_FINDING` |
| `@avp/agents-ship-finops` | `COST_ESTIMATE` (+ alert if over threshold) |
| `@avp/agents-ship-release-manager` | `READINESS_REPORT` |
| `@avp/agents-ship-deployment-engineer` | `DEPLOYMENT` + `ENV_TARGET` |
| `@avp/agents-ship-sre` | `KPI_OBSERVATION` (+ breach/incident if unhealthy) |

## Soft locks

1. Pipeline build requires QA pass (`BUILD` conclusion success for the feature)  
2. Safety requires pipeline build  
3. Readiness requires scan (+ cost)  
4. Deploy requires ready report; observe requires deployment  

## Release gate

`POST /studio/release/:id/approve` with `{ "role": "all" }` signs every role in the readiness `approvalSet` (demo convenience). Seeded Toll.OS already has `eng-lead` + `product` approvals.

## Toll.OS seed

- Clean security scan, ₹180/mo cost under ₹500 threshold  
- Ready report, production deploy, SLIs for billable events & double-bill rate  

## Key routes

| Platform | BFF |
|----------|-----|
| `/studio/builds…` | `/api/builds…` |
| `/studio/safety…` | `/api/safety…` |
| `/studio/release…` | `/api/release…` |
| `/studio/rollout…` | `/api/rollout…` |
