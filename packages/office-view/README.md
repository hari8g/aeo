# `@avp/office-view`

3D isometric office for AEO Studio, mounted at `/office`.

Six Bosch MPS department pods sit in a hexagonal ring around a live **knowledge-graph** billboard. Avatars are the real agent manifests. The right-hand panel is a single-pane Listen→Learn strip of every open FEATURE. Human gates reuse Studio's existing `/portfolio` and `/release` pages — the office is a lens, not a second decision surface.

Visual language (isometric camera, desk grid, etched graph billboard, stand-and-wave gates) is inspired by [agents-office](https://github.com/ajsahni/agents-office). That project's code is **not** vendored here (PolyForm Noncommercial). Techniques were re-implemented in AEO's own files and tokens.

## Build

```bash
# From the repo root. Roster step prefers a running Platform.
STUDIO_SECRET=avp-studio-dev-secret pnpm -F @avp/platform dev   # terminal A
pnpm -F @avp/office-view build                                  # terminal B
```

`build` writes `packages/studio-web/public/office/main.js`. If Platform is down, `scripts/build-roster.mjs` copies `src/roster.fallback.json` and warns.

Then:

```bash
pnpm -F @avp/studio-web dev:3001
```

Open `http://localhost:3001/office` (or `/office/dark`).

## Keyboard

| Key | Action |
|-----|--------|
| `1`–`6` | Fly to COR, GTM, ENG, Px, Cx, MKT |
| `G` | Focus the graph billboard |
| `B` | Company board (six departments × lifecycle rows) |
| `D` | Dark / light |
| `V` | Presentation dim |
| `Esc` | Overview, clear spine |

## Recolour a phase / add a badge

Edit `src/theme.js`:

- `DEPTS.<id>.chip` — pod rim and avatar colour
- `LAYOUT.<id>` — floor-plan slot
- `KIND_TO_PHASE` — which graph node kinds tint to that phase

Department ↔ phase pairing lives in one place: `DOMAIN_TO_DEPT` in `packages/platform/src/studio/officeRoutes.ts` (and the matching table in `theme.js`).

## Smoke check

```bash
pnpm -F @avp/office-view check
```
