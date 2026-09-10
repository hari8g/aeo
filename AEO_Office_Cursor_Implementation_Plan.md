# AEO Office — Cursor Implementation Plan

**How to use this file:** paste it into Cursor as the task brief (or `@`-reference it), and work
phase by phase. Each phase has a goal, exact files to create or edit, and acceptance criteria you
can check before moving on. Don't skip ahead — Phase 2 imports from Phase 1, Phase 4 depends on
Phase 3's endpoint contracts, and so on. Where a step says "port from `agents-office/src/X.js`",
that means: open the reference file, understand the technique, and adapt it — not copy the file
verbatim, because AEO's data model and runtime are different.

**Reference repos, already on disk for comparison:**
- `github.com/ajsahni/agents-office` — the 3D isometric office (Three.js), for visual language and
  interaction patterns only. Its license (PolyForm Noncommercial) means: **do not vendor its code
  wholesale into a commercial product.** Re-implement the *techniques* (billboard graph rendering,
  desk/pod layout, task panel UX) in AEO's own files, in AEO's own style. Treat it as a design
  reference, the way you'd treat a Dribbble shot — not as a dependency.
- `github.com/hari8g/aeo` — the target repository. Everything in this plan lands here.

---

## 0. What we're building, in one paragraph

A 3D isometric "office" view, reachable from Studio at `/office`, showing six department pods
arranged around a central **Knowledge Graph** (replacing agents-office's markdown-notes "Brain"
with AEO's real `graph_nodes`/`graph_edges` from Postgres). Each pod is one of the six AEO
lifecycle phases, labelled with its Bosch MPS department name. Agents sit at desks inside their
pod. A right-hand panel shows every active FEATURE's journey through the six phases as a single
Kanban strip — the "single pane" view. Clicking a FEATURE lights up the pods it has already
passed through, exactly like a current flowing along the spine described in AEO's own docs. Human
gates (Portfolio Gate, Release Gate, etc.) render as an agent standing and waving, waiting for a
click — reusing agents-office's approval metaphor verbatim, because it's the right metaphor and
it's already proven.

Nothing about AEO's actual agent runtime, graph schema, or orchestrator changes. This is a new
**view layer** — a fourth tier alongside Studio, Platform, and Agents — that reads the existing
graph and existing agent activity and renders it. It writes nothing except gate approvals, which
already go through the existing Studio API surface.

---

## 1. Department ↔ phase mapping (decide this before writing code)

AEO's six phases already map 1:1 onto Bosch MPS's six departments. This is the mapping this plan
implements. It's a judgment call — flag it to the PO/leadership before Phase 5 if you want it
changed, because the roster generator in Phase 5 is driven by this table.

| Phase (AEO domain) | MPS department | Why this pairing |
|---|---|---|
| **Listen** | **MPS/MKT** — Marketing | VoC Intelligence and Market Signal agents are literally a marketing function: customer voice, market intelligence, trend-watching. |
| **Decide** | **MPS/COR** — Controlling | Portfolio Management, Business Case and Value Engineering are financial governance — admit/defer/reject against a value band is a Controlling decision. |
| **Define** | **MPS/Px** — Product Areas | Requirements, domain modelling and bounded-context architecture are where Product Area ownership lives — this is the team that owns "what this thing is." |
| **Build** | **MPS/ENG** — Engineering | Software Engineering, Quality Engineering, Documentation. No argument needed. |
| **Ship** | **MPS/GTM** — Go-to-Market | DevOps/DevSecOps/FinOps/Release/Deployment/SRE collectively *bring the thing to market* — GTM owns the release-to-production motion in this reading. |
| **Learn** | **MPS/Cx** — Leadership | Attribution, Stakeholder Impact, Organizational Learning and Calibration feed the org's leadership review loop — outcomes and lessons are a leadership-team concern. |

Display order around the office (mirrors the user's stated order — COR, GTM, ENG, Px, Cx, MKT —
and doubles as the pod layout order, clockwise from the entrance): **COR → GTM → ENG → Px → Cx →
MKT**, i.e. Decide → Ship → Build → Define → Learn → Listen going clockwise. This deliberately does
*not* match the Listen→Learn execution order, so the office reads as an organizational floor plan,
not a flowchart — the flow direction is shown separately by the spine highlight in Phase 6.4.

---

## 2. Target architecture

```
packages/
  office-view/                    [NEW] — vanilla JS + Three.js, esbuild-bundled, exactly
    src/
      main.js                       like agents-office's src/main.js: scene, camera, pods, render loop
      pods.js                       pod geometry + desk layout (ported technique from builders.js)
      agents.js                     avatar rendering (ported technique from builders.js)
      graph.js                      the knowledge-graph billboard — replaces agents-office's brain.js
      panel.js                      the right-hand single-pane panel — replaces tasks.js
      spine.js                      [NEW CONCEPT] feature-journey highlight across pods
      gates.js                      human-gate "stand and wave" interaction
      api.js                        fetch/SSE client for the office endpoints (Phase 4)
      theme.js                      AEO design tokens (not agents-office's Nominal.so palette)
    scripts/
      build-roster.mjs              fetches /studio/office/roster at build time, writes roster.json
    build.mjs                       esbuild entry, mirrors agents-office/build.mjs
    package.json
    dist/                           gitignored build output

  platform/src/studio/
    officeRoutes.ts                 [NEW] registerOfficeRoutes(app) — roster, state, graph, stream

  studio-web/app/(app)/office/
    page.tsx                        [NEW] mounts a <div id="office-root"> + loads the office-view bundle
  studio-web/public/office/         [NEW] esbuild output copied here at build time (dist/*.js, *.css)
```

**Why a separate vanilla package instead of a React component:** Three.js scenes are imperative
and stateful in a way that fights React's reconciliation. `agents-office` proves the vanilla
approach works well for exactly this kind of scene. `office-view` is bundled standalone with
esbuild (same tool AEO already uses nowhere yet, but it's a 200kb dependency and agents-office's
`build.mjs` is a ~40-line reference for the whole setup) and mounted into the Next.js page as a
static bundle + script tag — the Next.js page does no rendering of its own beyond the mount point.
This is the same boundary agents-office draws between `serve.mjs` (Node/Express) and its browser
bundle; here the Node side is the existing Fastify Platform instead of a bespoke server.

**Data flow:**

```
Postgres (graph_nodes/graph_edges/cycles/agent_episodes)
         │
         ▼
platform/src/studio/officeRoutes.ts   (NEW — reads only, three endpoints + one stream)
         │  GET /studio/office/roster        (static-ish: department × agent list)
         │  GET /studio/office/state         (poll 2–3s: features, phase, gate status, busy agents)
         │  GET /studio/office/graph         (poll 5–10s: force-directed graph snapshot)
         │  GET /studio/office/stream        (SSE: forwards ContextBus events live)
         ▼
studio-web/app/api/office/*/route.ts   (thin platformFetch proxies, same pattern as every
                                         other /api/* route already in the repo)
         ▼
office-view/src/api.js                 (polling + EventSource client)
         ▼
office-view/src/{graph,panel,pods,spine,gates}.js   (render)
```

---

## 3. Phase-by-phase build order

Each phase below is sized to be a single focused Cursor session (roughly half a day to two days of
agent+human time). Do not start a phase until the previous phase's acceptance criteria are met —
the whole plan is designed so nothing later blocks on guesswork about something earlier.

### Phase 0 — Repo groundwork (0.5 day)

**Goal:** the new package exists, builds an empty scene, and is wired into the monorepo's turbo
pipeline, before any office-specific logic is written.

**Steps:**
1. `mkdir -p packages/office-view/src packages/office-view/scripts`
2. Create `packages/office-view/package.json`:
   ```json
   {
     "name": "@avp/office-view",
     "version": "0.1.0",
     "private": true,
     "type": "module",
     "scripts": {
       "build": "node build.mjs",
       "build:roster": "node scripts/build-roster.mjs"
     },
     "devDependencies": {
       "esbuild": "^0.28.1",
       "three": "^0.185.1"
     }
   }
   ```
3. Create `packages/office-view/build.mjs` — an esbuild bundle step. Reference
   `agents-office/build.mjs` for the shape (entry point, `bundle: true`, `format: 'esm'`,
   `outdir`), but point `outdir` at `packages/studio-web/public/office/`.
4. Create `packages/office-view/src/main.js` with just enough to prove the pipeline: a
   `THREE.Scene`, an orthographic camera (copy the exact camera setup style from
   `agents-office/src/main.js` line ~26 — `new THREE.OrthographicCamera(-1,1,1,-1,-400,800)` — an
   isometric camera is the whole visual identity here), a grey ground plane, `requestAnimationFrame`
   loop mounting into `document.getElementById('office-root')`.
5. Add `office-view` to the root `pnpm-workspace.yaml` (or confirm the existing glob already
   covers `packages/*`).
6. Add `"build": "turbo run build"` coverage: confirm `turbo.json` picks up the new package
   automatically (it should, if pipeline tasks are keyed by script name, not by explicit package
   list).
7. Create `packages/studio-web/app/(app)/office/page.tsx`:
   ```tsx
   'use client'
   import { useEffect, useRef } from 'react'

   export default function OfficePage() {
     const ref = useRef<HTMLDivElement>(null)
     useEffect(() => {
       const script = document.createElement('script')
       script.type = 'module'
       script.src = '/office/main.js'
       document.body.appendChild(script)
       return () => { document.body.removeChild(script) }
     }, [])
     return <div id="office-root" ref={ref} style={{ position: 'fixed', inset: 0 }} />
   }
   ```
8. Add an `/office` link into the Studio nav (find the nav component used by every other
   `(app)/*` route — likely a shared layout/sidebar in `app/(app)/layout.tsx` — add a new entry
   following the exact same pattern as `pain-points`, `portfolio`, etc.).

**Acceptance:** `pnpm -F @avp/office-view build` produces `packages/studio-web/public/office/main.js`.
`pnpm -F @avp/studio-web dev` and visiting `/office` shows a grey ground plane rendered in an
isometric projection, full-bleed, no console errors.

---

### Phase 1 — Port the visual shell (pods, desks, avatars) (2–3 days)

**Goal:** the six department pods exist in their MPS-mapped positions with idle agent avatars at
desks, matching agents-office's visual quality, using AEO's own colour tokens.

**Steps:**
1. Create `packages/office-view/src/theme.js` — AEO's own design tokens, not agents-office's
   Nominal.so palette. Base it on the palette already established across the HTML demos in this
   engagement (`--riaf:#0D9488`, `--assess:#BE185D`, `--plan:#B45309`, `--po:#7C3AED`, the six
   phase colours already defined: `Define #4F46E5, Build #0D9488, PO-loop #7C3AED, QA #D97706,
   Compliance #DC2626, Stage/UAT #0369A1, Prod #059669`). Assign one colour per department per
   the Phase-1 mapping table in section 1 above — reuse the phase colours directly, since
   department = phase here:
   ```js
   export const DEPTS = {
     mkt: { name: 'MPS/MKT', phase: 'listen', full: 'Marketing', chip: '#0D9488' },
     cor: { name: 'MPS/COR', phase: 'decide', full: 'Controlling', chip: '#4F46E5' },
     px:  { name: 'MPS/Px',  phase: 'define', full: 'Product Areas', chip: '#7C3AED' },
     eng: { name: 'MPS/ENG', phase: 'build',  full: 'Engineering', chip: '#0369A1' },
     gtm: { name: 'MPS/GTM', phase: 'ship',   full: 'Go-to-Market', chip: '#D97706' },
     cx:  { name: 'MPS/Cx',  phase: 'learn',  full: 'Leadership', chip: '#059669' },
   }
   export const LAYOUT = {
     // hexagonal ring around the centre, in the display order from section 1
     graph: { pos: [0, 0], w: 16, d: 16 },
     cor:   { pos: [30, -23], w: 20, d: 26 },
     gtm:   { pos: [0, -48],  w: 20, d: 30 },
     eng:   { pos: [-30, -23], w: 20, d: 30 },
     px:    { pos: [-30, 23],  w: 20, d: 30 },
     cx:    { pos: [0, 48],    w: 20, d: 26 },
     mkt:   { pos: [30, 23],   w: 20, d: 30 },
   }
   ```
   (Positions copied structurally from `agents-office/src/data.js`'s `LAYOUT` — same hexagonal
   ring, same spacing discipline — with the six slots reassigned to AEO's departments.)
2. Create `packages/office-view/src/pods.js`. Port the *technique* from
   `agents-office/src/builders.js`: rounded-rectangle floor plinths (`rboxGeo` helper — extrude a
   rounded-corner shape), a low wall or edge highlight in the department's chip colour, and a
   billboard label sprite (the `mkLabel`/canvas-texture-to-sprite pattern used throughout
   `builders.js`) showing `MPS/MKT` etc. above the pod.
3. Create `packages/office-view/src/agents.js`. Port the *technique* for a simple avatar (capsule
   torso + sphere head, per `builders.js`'s `mkPerson`-style function) — keep it simpler than
   agents-office's fully-articulated figures; AEO doesn't need the same fidelity, and a simpler
   avatar is faster to build correctly. One avatar per agent manifest, seated at a desk in a grid
   within its pod (reuse the `grid: [col, row]` desk-slot idea from `agents-office/src/data.js`).
4. Wire `main.js` to instantiate all six pods via `pods.js` and populate desks via `agents.js`,
   using a **placeholder roster** hardcoded in this phase (real roster comes in Phase 5) — e.g. 2
   agents in MKT, 5 in COR, 3 in Px, 3 in ENG, 6 in GTM, 4 in Cx, matching the real manifest counts
   so the pod sizing is realistic from the start.
5. Camera controls: orbit/pan/zoom. Port the interaction technique from
   `agents-office/src/main.js` (search for `OrbitControls`-equivalent or its custom drag-to-pan
   implementation — agents-office does NOT use `THREE.OrbitControls` per the environment's r128
   constraint mentioned in this engagement's tooling notes; if `three@0.185` is available here,
   `OrbitControls` is fine to use directly and is simpler).
6. Keyboard shortcuts, ported directly (same keys, same feel, because they're good defaults):
   `1`–`6` jump-focus a department, `Esc` returns to overview, `V` full-screen dimmed view.

**Acceptance:** all six pods render in their hexagonal ring, correctly labelled and coloured per
the department table, with the right number of idle avatars seated at desks in each. Camera
orbits smoothly. Pressing `1`–`6` flies the camera to each pod in turn.

---

### Phase 2 — Knowledge Graph billboard (replaces "the Brain") (2 days)

**Goal:** the centre of the office shows AEO's actual knowledge graph — not agents-office's
markdown-vault graph — rendered with the same visual technique (an ink-etched billboard that
faces the camera, pulses on activity).

**Steps:**
1. On the **Platform** side, create `packages/platform/src/studio/officeRoutes.ts` with a first
   endpoint:
   ```ts
   export async function registerOfficeRoutes(app: FastifyInstance, deps: { ... }) {
     app.get('/studio/office/graph', async () => {
       const nodes = await query(`SELECT id, kind, created_at FROM graph_nodes
                                   ORDER BY created_at DESC LIMIT 400`)
       const edges = await query(`SELECT source_id, target_id, kind FROM graph_edges
                                   WHERE source_id = ANY($1) OR target_id = ANY($1)`,
                                   [nodes.rows.map(n => n.id)])
       // compute a force-directed layout server-side with d3-force (add as a Platform
       // dependency — agents-office already proves this exact library works well for this
       // exact job in graph-build.mjs)
       const layout = computeForceLayout(nodes.rows, edges.rows)  // { id, x, y } per node, [-1,1] range
       return { notes: nodes.rowCount, nodes: layout, links: edgeIndexPairs(edges.rows, nodes.rows) }
     })
   }
   ```
   Add `d3-force` as a `packages/platform` dependency (already a proven fit — it's what
   `agents-office/graph-build.mjs` uses to pre-lay-out the brain graph offline; here we run the
   same algorithm on live data, on demand, server-side).
2. Register the route in `packages/platform/src/server.ts` next to
   `registerStudioRoutes(app, ...)` — `await registerOfficeRoutes(app, { ... })` — and add its
   path prefix (`/studio/office/`) to the existing `STUDIO_PREFIXES` allow-list so the
   `X-Studio-Secret` auth hook already in `server.ts` covers it for free.
3. Add the BFF proxy: `packages/studio-web/app/api/office/graph/route.ts`, copying the exact
   two-line pattern from `packages/studio-web/app/api/connectors/route.ts` (`platformFetch` +
   `Response.json`).
4. On the **office-view** side, create `packages/office-view/src/graph.js`. Port the *rendering
   technique* wholesale from `agents-office/src/brain.js`:
   - a camera-facing `THREE.Sprite` billboard, sized and centred exactly as described in that
     file's own comments (`BW = 17, BH = BW * 0.6`, centred above the middle pod).
   - a `<canvas>` 2D context drawing edges as faint lines and nodes as dots sized by degree
     (`(0.8 + √links·0.28)·PX/130` — same formula, it produces a good result).
   - **the one real change:** colour nodes by AEO phase/domain instead of markdown folder. Map
     each `graph_nodes.kind` to its owning phase (PAIN_POINT/MARKET_SIGNAL → listen,
     BUSINESS_CASE/VALUE_MODEL → decide, USER_STORY/BOUNDED_CONTEXT → define, etc. — this mapping
     already exists implicitly in `packages/shared/src/graphKinds.ts`'s comments and should be
     made explicit as a small lookup table in `graph.js`), and tint each node with that phase's
     colour from `theme.js`. The graph should visibly show which phases are graph-heavy right now.
5. Wire `api.js`'s polling: `fetch('/api/office/graph')` every 7–10 seconds, feed the result into
   `graph.js`'s update function, re-etch the canvas, call `texture.needsUpdate = true` (same
   mechanic as `brain.js`'s `etch()`).
6. Port the "write" animation: when the poll detects a node that wasn't present last poll, animate
   it appearing near its owning department's pod (not a random floor position — this is a
   deliberate improvement on agents-office's random note placement, and directly supports the
   "beautiful and understandable" ask: a new `BUSINESS_CASE` node should visibly appear near the
   Controlling pod).

**Acceptance:** the centre billboard renders real graph data — node and edge counts on the
billboard match `SELECT count(*) FROM graph_nodes` for the visible window. Triggering a real agent
write (run any existing seed or a live agent task against the Platform) causes a new dot to appear
near the correct department pod within one polling interval, without a page reload.

---

### Phase 3 — Roster from the real manifests, not a hardcoded list (1 day)

**Goal:** every avatar at every desk corresponds to a real `AgentManifest`, with its real name,
archetype and domain — replacing Phase 1's placeholder roster.

**Steps:**
1. Add a Platform endpoint `GET /studio/office/roster` in `officeRoutes.ts`. It does **not** hit
   the database — it statically imports every agent manifest exactly the way
   `packages/platform/src/studio/studioRoutes.ts` already does at its top (the same 23 `import {
   X_MANIFEST } from '@avp/agents-...'` lines), and returns:
   ```json
   {
     "agents": [
       { "id": "voc-intelligence:v1", "name": "VoC Intelligence Agent",
         "archetype": "Voice of Customer Analyst", "domain": "listen", "dept": "mkt" },
       ...
     ]
   }
   ```
   The `domain → dept` mapping is the six-row table from section 1, hardcoded once as a `const
   DOMAIN_TO_DEPT` in this file — the single source of truth other than this markdown doc.
2. BFF proxy: `packages/studio-web/app/api/office/roster/route.ts`, same two-line pattern.
3. In `packages/office-view/scripts/build-roster.mjs`, fetch this endpoint **at build time**
   (Platform must be running when `pnpm -F @avp/office-view build` runs — document this in the
   package's own README) and write `packages/office-view/src/roster.generated.json`. This mirrors
   agents-office's philosophy of a single roster file (`office.agents.json`) as ground truth, but
   AEO's ground truth is the manifests, not a hand-maintained JSON file — so we generate it instead
   of hand-writing it. Fall back to a small checked-in `roster.fallback.json` (a snapshot of the
   23 current agents) if the Platform isn't reachable at build time, so CI and offline builds don't
   break — log a clear warning when this happens.
4. Update `agents.js` (Phase 1) to read `roster.generated.json` (falling back as above) instead of
   the hardcoded placeholder, grouping by `dept` and laying out desks within each pod exactly as
   `agents-office/src/data.js` does with its `grid: [col, row]` — assign grid slots
   programmatically (row-major fill) since AEO's roster doesn't hand-author grid positions.
5. Hovering an avatar shows a tooltip: name, archetype, domain, and — new, because AEO has this
   and agents-office doesn't — the agent's `requiresGate` flag and current rate-limit headroom
   (pull from the existing manifest's `capabilities` object).

**Acceptance:** desk counts per pod match the real manifest counts (MKT 2, COR 5, Px 3, ENG 3, GTM
6, Cx 4 = 23 total). Renaming or adding a manifest in the agents packages and rebuilding
`office-view` changes the office without editing any office-view source file.

---

### Phase 4 — Live state: tasks, busy agents, human gates (3 days)

**Goal:** the office shows what's actually happening right now — which agents are working, which
features are waiting on a human gate — not just a static roster.

**Steps:**
1. Design the **task model** for the office. AEO doesn't have a "task" entity the way
   agents-office does — it has `FEATURE`s moving through `cycles.current_stage`, and
   `agent_episodes` recording individual agent runs. Map these onto agents-office's task lifecycle
   states, because that vocabulary (`SCHEDULED → BACKLOG → IN PROGRESS → WAITING ON APPROVAL →
   DONE`) is well-designed and end users of *this* engagement have already validated it in the
   HTML demos' spine-diagram language:

   | Office state | AEO source |
   |---|---|
   | `doing` | an `agent_episodes` row for this feature/phase with no `completed_at` yet |
   | `waiting` | the feature's current phase has a manifest `requiresGate: true` step whose
     `DECISION_RECORD` / gate node doesn't exist yet (Portfolio Gate, Release Gate, etc.) |
   | `done` | `cycles.current_stage` has advanced past this phase for this feature |
   | `sched` | reserved for Phase 7 (routines) — leave the column empty until then |
   | `next` | a feature exists with `cycle_closed = false` whose current stage is this phase, no
     open episode yet |

2. Add `GET /studio/office/state` to `officeRoutes.ts`:
   ```ts
   app.get('/studio/office/state', async () => {
     const features = await query(`SELECT id, name, current_stage, cycle_closed FROM cycles
                                    JOIN graph_nodes ON ... WHERE cycle_closed = false`)
     const episodes = await query(`SELECT agent_id, feature_id, started_at, completed_at
                                    FROM agent_episodes WHERE completed_at IS NULL`)
     const gates = await query(`SELECT feature_id, stage, gate_kind FROM ... /* pending gates */`)
     return { features: features.rows.map(mapToOfficeTask), busyAgents: episodes.rows.map(...) }
   })
   ```
   (Exact SQL depends on final `cycles`/`agent_episodes` column names — check
   `packages/platform/src/db/` migrations for the authoritative schema before writing this; the
   shape above is the contract, not necessarily the literal query.)
3. BFF proxy `packages/studio-web/app/api/office/state/route.ts`.
4. Create `packages/office-view/src/panel.js` — the single-pane right-hand panel. Port the visual
   structure from `agents-office/src/tasks.js`'s Task Status panel (the "always on, right side"
   panel described in its own comments around line 269), but restructure the columns: instead of
   one department's `DOING/NEXT/DONE`, show **all six phases as columns in one row**, each column
   showing that phase's active features as compact cards. This is the direct answer to "as much as
   possible in a single pane" — the whole Listen→Learn pipeline, all six phases, visible without
   switching views.
5. Each feature card shows: name, a small coloured dot per phase already completed (a mini spine,
   see Phase 6), and — if `waiting` — the exact agents-office affordance: the card gets a subtle
   amber pulse and an "① awaiting your decision" chip.
6. Clicking a `waiting` card opens the existing Studio gate UI for that decision (link out to
   `/portfolio`, `/release`, etc. — whichever existing Studio route owns that gate) rather than
   reimplementing gate approval inside the office view. The office view is a lens onto the system,
   not a second place to make the same decision.
7. In the 3D scene, wire `gates.js`: when `state.js` reports a feature `waiting` in a given
   department's phase, the pod's **lead agent avatar** (the one manifest per phase marked as the
   primary/first-listed agent, or introduce a `lead: true` flag by convention — port this concept
   directly from `agents-office/src/data.js`'s `lead: true` field) plays a small "stand and wave"
   animation (a simple bounce + arm-raise tween is enough; agents-office's actual animation code in
   `builders.js`/`main.js` is worth reading for the tween approach, not for a literal copy).
8. Wire `busyAgents` from the poll into `agents.js`: a busy avatar gets a subtle glow or a small
   spinning icon above its desk (port technique from wherever agents-office indicates `state ===
   'doing'` visually on an avatar).
9. Add the SSE endpoint for lower latency than polling, once polling works end-to-end: `GET
   /studio/office/stream` in `officeRoutes.ts`, subscribing to the existing `ContextBus` (already
   built for exactly this — see `packages/platform/src/bus/contextBus.ts`) on `context.>` and
   forwarding each `AgentContextEvent` as an SSE message. `api.js` opens an `EventSource` and
   applies incremental updates instead of waiting for the next poll; **keep the polling as a
   fallback** for when SSE drops, exactly as the office's own design principle elsewhere in this
   engagement (in-process fallback when the primary channel is unavailable) already establishes.

**Acceptance:** running a real agent task against the Platform (any existing seeded flow) causes,
within seconds: the busy avatar to visibly animate, the panel's card for that feature to move
columns, and — on reaching a gated phase — the lead avatar to visibly wave and the card to pulse
amber. Clicking the waving avatar or the pulsing card navigates to the correct existing Studio gate
page.

---

### Phase 5 — Connector bar (real integrations, not agents-office's demo ones) (0.5 day)

**Goal:** replace agents-office's Slack/Gmail/Notion connector bar with AEO's actual connector
list, using the same "pulses when used" affordance.

**Steps:**
1. Add `GET /studio/office/connectors` — this can be a thin re-export of the existing
   `/connectors` endpoint already in `studioRoutes.ts`; no new backend logic needed, just expose it
   under the office namespace for a single fetch surface, or have `office-view` call the existing
   `/api/connectors` route directly (simpler — prefer this unless there's a reason to duplicate).
2. In `office-view`, add a top bar rendering connector logos (reuse `agents-office/src/mcplogos.js`
   only for its *technique* of embedding SVG logos as data — AEO's actual connector set from this
   engagement's Track B plan is HubSpot, Zendesk, Slack, etc., so the logo set itself must be
   AEO's, sourced fresh, not copied from agents-office's bundled marks).
3. Wire the pulse: when an SSE event or poll shows an agent episode with a `connector` field
   matching a bar entry, flash that logo and draw a brief animated line from the logo to the
   relevant pod (port the "wire lights up" technique from agents-office's connector-to-pod
   wiring, referenced in its own README under "Connectors").

**Acceptance:** the connector bar shows exactly the connectors configured in AEO's own
`studio_connectors` table for the current workspace — not a demo set.

---

### Phase 6 — The spine highlight (new concept, not in agents-office) (1.5 days)

**Goal:** clicking any FEATURE card lights up its journey across the pods it has actually passed
through — a direct visualization of the spine concept established in this engagement's earlier
HTML mock (`listen_decide_flow.html`) and reference decks, now rendered in 3D across real pods
instead of as a static diagram.

**Steps:**
1. Create `packages/office-view/src/spine.js`.
2. On selecting a feature (click its panel card, or click any node on the graph billboard that
   belongs to it — join via the existing `graph_edges` chain: FEATURE ← MOTIVATES/ESTIMATES/
   INFORMS/… ← every artifact node), compute the ordered list of phases it has entered, using
   `cycles.current_stage` history if tracked, or, absent explicit history, the presence of at
   least one node/edge typed to that phase.
3. Animate a travelling light (a small emissive sphere on a `THREE.CatmullRomCurve3` path) moving
   pod-to-pod in phase order, pausing briefly at each pod the feature has completed, and stopping
   at its current pod with a steady glow. Grey out (reduce opacity of) every pod not yet reached.
4. Show a small floating label at each stop: the phase name and how long the feature spent there
   (compute from `agent_episodes` timestamps for that feature/phase pair).
5. Pressing `Esc` or clicking empty space clears the spine and restores full brightness to all
   pods.

**Acceptance:** selecting a real feature that has, say, completed Listen/Decide/Define and is
currently in Build shows the light travelling through MKT → COR → Px and resting, glowing, at ENG,
with the other three pods (GTM, Cx, and any not-yet-relevant) dimmed.

---

### Phase 7 — Company board, routines, polish (2 days)

**Goal:** feature parity with agents-office's remaining well-designed affordances that add real
value, ported deliberately rather than by default; visual and performance polish; docs.

**Steps:**
1. Port the **company board** (agents-office's `B` key): a full-screen 2D Kanban of every
   department's `SCHEDULED / BACKLOG / IN PROGRESS / WAITING ON APPROVAL / DONE`, but restructured
   as **six columns (departments) × the phase-lifecycle rows**, so it's the same single-pane
   promise as the 3D panel, just denser and better for scanning many features at once. Bind to `B`.
2. Port **dark mode** (`D` key, `/office/dark` route) — straightforward CSS/texture-colour swap,
   agents-office's `setTheme` pattern in `brain.js`/`main.js` is a clean reference.
3. Port **full-screen dimmed view** (`V` key) for presentation/demo mode — exactly the mode used
   to produce clean screenshots for the earlier HTML decks in this engagement; useful for the same
   purpose here.
4. Performance pass: confirm the scene holds 60fps with all 23 avatars, the full graph billboard,
   and an active spine animation together on a mid-range laptop. Reduce shadow quality / avatar
   poly count first if not — agents-office's own performance choices (baked textures over dynamic
   shadows) are the right template.
5. Write `packages/office-view/README.md`: what it is, how to build it (`pnpm -F @avp/office-view
   build`, requires Platform running for the roster step), how to add a new department badge or
   recolour a phase, and a note that this package draws visual inspiration from `agents-office`
   (credit it) without vendoring its code.
6. Add a short section to the root `README.md` pointing at `/office` as a new Studio surface.
7. Smoke test: add an `office-view` check to whatever CI/`check.mjs`-equivalent exists in AEO
   today (if none exists yet, a simple headless-Playwright "does `/office` render without console
   errors" check, mirroring agents-office's own `check.mjs` philosophy, is a good minimum).

**Acceptance:** `B`, `D`, `V`, `1`–`6`, `G`-equivalent (graph focus), `Esc` all work as documented.
The office runs smoothly with the full real roster and live data. A newcomer reading only the
package README can build and run it standalone.

---

## 4. What deliberately does *not* get ported from agents-office

Being explicit about this saves a Cursor session from wandering into scope that doesn't belong
here:

- **Routines/scheduling UI** (agents-office's cron-like task scheduler). AEO's agents run off the
  event-driven context bus and orchestrator predicates, not a clock. There is no "every weekday at
  8am" concept in AEO's execution model — don't invent one for the office view.
- **Chat with an individual agent.** AEO agents are backend workers triggered by graph events, not
  conversational personas the PO chats with directly (that's Studio's job, if and where it exists).
  The office view is a dashboard, not a second chat surface.
- **Feedback/correction learning loop** (agents-office's `revise:` mechanism writing to
  `feedback/<agent>.md`). AEO already has a real calibration mechanism —
  `agent_calibration`/`CALIBRATION_RECORD`, fed by the Learn phase. Don't build a parallel,
  simplified one in the office view.
- **Claude Code / `claude mcp list` integration for roster editing.** AEO's roster is the agent
  manifests, which are TypeScript source files reviewed and deployed like any other code — not
  something a PO free-types changes into via a chat command.
- **The particle-nebula brain (already retired in agents-office itself)** — don't resurrect an
  approach the reference project's own commit history explicitly moved away from
  (`src/brain.js`'s top comment: "the particle nebula is RETIRED"). Build on their *current*
  etched-floor/billboard approach, not an earlier one.

---

## 5. Open questions to settle with the PO before or during Phase 4

- **Gate ownership check:** should the office view enforce who is allowed to click through to a
  gate (Admin/Editor per existing Studio RBAC), or is it purely a read/navigate surface with the
  actual permission check happening on the destination page (recommended — don't duplicate auth
  logic)?
- **Multi-tenant / multi-workspace:** does one office view render one workspace's graph, or does it
  need a workspace switcher? (Assume single-workspace for v1 unless told otherwise — the existing
  `workspace_id='default'` pattern in `studioRoutes.ts`'s connector query suggests AEO itself is
  currently single-workspace in practice.)
- **Historical playback:** section 6's spine shows current state. A natural v2 ask is "replay how
  this feature moved through the office over the last two weeks" — flag as a follow-on, not part
  of this plan's scope.

---

## 6. Summary of new/changed files

```
NEW   packages/office-view/                      (whole package, ~10 files)
NEW   packages/platform/src/studio/officeRoutes.ts
EDIT  packages/platform/src/server.ts             (register officeRoutes, extend STUDIO_PREFIXES)
EDIT  packages/platform/package.json              (add d3-force dependency)
NEW   packages/studio-web/app/(app)/office/page.tsx
NEW   packages/studio-web/app/api/office/roster/route.ts
NEW   packages/studio-web/app/api/office/state/route.ts
NEW   packages/studio-web/app/api/office/graph/route.ts
NEW   packages/studio-web/app/api/office/stream/route.ts
NEW   packages/studio-web/public/office/          (build output, gitignored)
EDIT  packages/studio-web/app/(app)/layout.tsx     (add nav entry)
EDIT  README.md                                   (point at /office)
```

Nothing in `packages/agents/*`, `packages/shared/*`'s `graphKinds.ts`, or the database schema
needs to change for any of this. The office view is additive and read-mostly by design.
