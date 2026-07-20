# Listen phase

## Purpose

Capture customer voice and surface **pain points** before any business case work.

## Sidebar

- **Add Feedback** → `/feedback`  
- **Pain Points** → `/pain-points`  

## Agents

| Package | Agent | Role |
|---------|-------|------|
| `@avp/agents-listen-voc-intelligence` | `VoCIntelligenceAgent` | Ingest / cluster feedback into pain points |

## Studio behavior

- CSV / connector ingest (Intercom-style connectors in Settings)  
- Pain Points board lists curated demo pains (exactly **2** after seed)  
- CTA **Start working on this →** opens Business Case create flow  

## Demo pains

1. Toll.OS MLFF events not metered for Bosch MPS **₹5/event** revenue  
2. StaaS 3PL warehouse inventory lag breaks outbound dock planning  

Fixtures: `packages/studio-web/demo/mps-pain-points.json`, `mps-feedback.csv`.

## Key routes

| Platform | BFF |
|----------|-----|
| `GET /studio/pain-points` | `GET /api/pain-points` |
| `GET /studio/stats` | home stats |
| VoC ingest endpoints | `/api/...` under feedback / connectors |

## Related guides

- `voc_simple_studio_cursor_guide.md`  
- `studio_implementation.md` (VoC validation notes)  
