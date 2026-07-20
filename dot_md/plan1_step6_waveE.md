# Plan 1 — Step 6 Wave E

**Status**: Complete  
**Scope**: Remaining Ship agents (DevSecOps already existed)  

| Package | Id | CLI-ready name |
|---------|-----|----------------|
| `@avp/agents-ship-devops` | `devops:v1` | yes (`build_completed`) |
| `@avp/agents-ship-finops` | `finops:v1` | yes |
| `@avp/agents-ship-release-manager` | `release-manager:v1` | gate for production; BLOCKS_RELEASE check |
| `@avp/agents-ship-deployment-engineer` | `deployment-engineer:v1` | |
| `@avp/agents-ship-sre` | `sre:v1` | observability runtime |

## Exit criteria

E2E: build → cost forecast → clean DevSecOps scan → release candidate → deployment → healthy SLO.
