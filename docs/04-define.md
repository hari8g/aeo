# Define phase

## Purpose

After **Admit**, lock shared language and system shape before engineering records a changeset.

## Sidebar

| Nav | Path | Statuses |
|-----|------|----------|
| Requirements | `/requirements` | Needs requirements · Stories drafted |
| Domain Model | `/domain` | Needs domain model · Domain modeled |
| Architecture | `/architecture` | Needs architecture · Architecture proposed |

Boards list **admitted** features only (Toll.OS shows; StaaS awaiting does not).

## Agents

| Package | Agent | Writes |
|---------|-------|--------|
| `@avp/agents-define-requirements-analyst` | RequirementsAnalyst | `USER_STORY` ←`REFINES`← FEATURE; AC ←`ACCEPTS`← story |
| `@avp/agents-define-domain-steward` | DomainSteward | `DOMAIN_CONCEPT`, `KPI`, `REGULATION`, `BUSINESS_RULE` |
| `@avp/agents-define-solutions-architect` | SolutionsArchitect | `BOUNDED_CONTEXT`, `SERVICE_INTERFACE` |

## Soft locks

1. Not admitted → Portfolio Review  
2. No stories → Requirements (domain + architecture)  
3. Architecture draft requires stories  

## Toll.OS seed highlights

- 4 stories (ANPR ₹5, RFID+ANPR fusion, LiDAR exception, idempotent ledger) × 2 ACs  
- Concepts: orchestration event, ANPR, FASTag RFID, LiDAR exception  
- Contexts: Sensor Fusion → Exception Orchestration → Event Metering → Billing Ledger  

## Key routes

| Platform | BFF |
|----------|-----|
| `GET/POST /studio/requirements…` | `/api/requirements…` |
| `GET/POST /studio/domain…` | `/api/domain…` |
| `GET/POST /studio/architecture…` | `/api/architecture…` |
