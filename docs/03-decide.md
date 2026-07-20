# Decide phase

## Purpose

Turn a pain into a sized, positioned business case and a portfolio **Admit / Defer / Reject** decision.

## Sidebar

- **Business Cases** → `/business-cases` (+ value & effort tabs)  
- **Go-to-Market** → `/gtm`  
- **Portfolio Review** → `/portfolio`  
- **Decision History** → `/decisions`  

## Agents

| Package | Alias in Studio |
|---------|-----------------|
| `@avp/agents-decide-business-case` | Business case writer |
| `@avp/agents-decide-value-engineering` | Business value |
| `@avp/agents-decide-solutions-estimation` | Engineering effort |
| `@avp/agents-decide-product-strategy` | GTM strategy |
| `@avp/agents-decide-portfolio-management` | Portfolio advisor |

## Flow

```
Pain Point → Write business case → Send for sizing
  → Estimate value (INR for Toll.OS) → Estimate effort
  → Plan GTM → Assemble packet → Portfolio decide
```

## Statuses (Business Cases board)

Needs your review · Draft · Sizing in progress · Awaiting decision · ✓ Admitted · ↩ Deferred · ✗ Rejected

## Demo outcomes

| Case | Currency | Gate |
|------|----------|------|
| Toll.OS MLFF metering (₹5/event) | INR ₹7.0M–₹11.0M | **Admitted** |
| StaaS 3PL inventory | EUR €420K–€980K | **Awaiting decision** |

Hariprasad is seeded as portfolio approver (CPO). Pradeep is read-only.

## Key routes

See [10-api-routes.md](./10-api-routes.md) Decide section.

## Related guides

- `business_case_studio_cursor_guide.md`  
- `business_value_studio_cursor_guide.md`  
- `engineering_effort_studio_cursor_guide.md`  
- `gtm_strategy_studio_cursor_guide.md`  
- `portfolio_advisor_studio_cursor_guide.md`  
- `decide_phase_closing_cursor_guide.md`  
