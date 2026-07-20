# Customer Insights Studio — Implementation & UI Reference

**Date**: 2026-07-20  
**Guides**: VoC · Decide · Define · Build · Ship · Learn (full loop)  
**Status**: Complete (Listen → Decide → Define → Build → Ship → Learn → loop closed)  
**Use this file** when you want Cursor to match the Studio’s **Bosch MPS look**, demo users, and local run path.

---

## UI inspiration source

Primary reference (live marketing site):

- [Bosch Mobility Platform & Solutions — Home](https://www.bosch-mps.com/en/home)

Design intent for Studio:

- Clean white header / sidebar with Bosch corporate logo
- Product line label: **Mobility Platform & Solutions**
- App name: **Customer Insights**
- Hero-style login headline copied from MPS: *“We empower the future of mobility and logistics.”*
- Accent color = **Bosch red** (`#E20015`), not generic purple / pink SaaS themes
- Light gray page surface (`#F5F6F8`), dark ink text, muted secondary labels
- Rounded interactive surfaces (`10px` / `12px`), sparse borders — not card-heavy dashboards

---

## Brand assets & tokens

| Item | Location / value |
|------|------------------|
| Bosch logo (SVG) | `packages/studio-web/public/brand/bosch-logo.svg` |
| Logo component | `packages/studio-web/components/BoschLogo.tsx` (`variant`: `full` \| `mark`) |
| Tailwind tokens | `packages/studio-web/tailwind.config.ts` |
| Global surface | `packages/studio-web/app/globals.css` — body `#1A1A1A` on `#F5F6F8` |
| Sidebar shell | `packages/studio-web/components/Sidebar.tsx` |
| Login shell | `packages/studio-web/app/login/page.tsx` |
| Home greeting | `packages/studio-web/app/(app)/page.tsx` |

### Color tokens (use these names in UI work)

```
bosch.red      #E20015   /* primary CTA, active nav, avatar */
bosch.redSoft  #FFF1F2   /* soft highlight bg */
bosch.muted    #5C6670   /* eyebrow / secondary labels */
bosch.ink      #1A1A1A
bosch.surface  #F5F6F8
bosch.line     #E5E7EB

/* Compatibility aliases (same red family) */
pink           #E20015
pink.bg        #FFF1F2
pink.bd        #FECACA

ink.1 / ink.2 / ink.3
surface.1 (white) / surface.2 (page bg)
line
```

Semantic status colors (non-brand): `ok` green, `amber`, `blue` — keep for pain-point / health chips only.

### Typography & shape

- Sans stack: Inter via `--font-inter` (see app layout)
- Eyebrows: `11px`, bold, uppercase, wide tracking (`0.06em`–`0.08em`), `text-bosch-muted`
- Titles: extrabold, tight tracking, `text-ink-1`
- Radii: `rounded-xl2` (10px), `rounded-xl3` (12px)

### Public brand path

Middleware must allow unauthenticated logo fetch:

- Matcher excludes `brand` → `/brand/bosch-logo.svg` is public (`packages/studio-web/middleware.ts`)

---

## Layout patterns to reuse

1. **Login**
   - Top bar: Bosch logo + “Mobility Platform & Solutions” / “Customer Insights” + link to bosch-mps.com
   - Centered form on `bg-surface-2`
   - Primary button: `bg-bosch-red` white text
   - Demo CTA when `DEMO_BYPASS=1`

2. **App shell**
   - Sticky left sidebar (white, border-r)
   - Logo mark + product line + “Customer Insights”
   - Active nav: `bg-pink-bg text-pink border-pink-bd`
   - Footer user chip: red circle initials + name + role

3. **Home**
   - Eyebrow: Bosch Mobility Platform & Solutions
   - Greeting: `Good morning, Hariprasad`
   - Demo banner in soft Bosch red when `?demo=1`
   - Optional outbound link to [bosch-mps.com](https://www.bosch-mps.com/en/home)

When extending UI, prefer these patterns over inventing a new theme.

---

## What shipped (code map)

| Area | Location |
|------|----------|
| Next.js app | `packages/studio-web/` (`@avp/studio-web`) |
| Studio DB tables | `packages/platform/src/db/schema.sql` (`studio_*`) |
| Studio API routes | `packages/platform/src/studio/studioRoutes.ts` |
| Seed users + demo business case | `packages/platform/src/db/seed.ts` → `pnpm -F @avp/platform db:seed` |
| Demo prepare | `packages/studio-web/app/api/demo/prepare/route.ts` |
| Auth / demo admin | `packages/studio-web/auth.ts` |
| MPS pain-point fixtures | `packages/studio-web/demo/mps-pain-points.json`, `mps-feedback.csv` |
| Business Cases UI | `packages/studio-web/app/(app)/business-cases/` |
| Business Value UI | `packages/studio-web/app/(app)/business-cases/[id]/value/` |
| Engineering Effort UI | `packages/studio-web/app/(app)/business-cases/[id]/effort/` |
| Go-to-Market UI (Decide section) | `packages/studio-web/app/(app)/gtm/` |
| Portfolio Review UI (Decide section) | `packages/studio-web/app/(app)/portfolio/` |
| Decision History | `packages/studio-web/app/(app)/decisions/` |
| Requirements UI (Define section) | `packages/studio-web/app/(app)/requirements/` |
| Domain Model UI (Define section) | `packages/studio-web/app/(app)/domain/` |
| Architecture UI (Define section) | `packages/studio-web/app/(app)/architecture/` |
| Implementation UI (Build section) | `packages/studio-web/app/(app)/build/` |
| Quality UI (Build section) | `packages/studio-web/app/(app)/quality/` |
| Docs UI (Build section) | `packages/studio-web/app/(app)/docs/` |
| Builds / Safety / Release / Rollout (Ship) | `packages/studio-web/app/(app)/builds|safety|release|rollout/` |
| Outcomes / Impact / Lessons (Learn) | `packages/studio-web/app/(app)/outcomes|impact|lessons/` |
| Ship + Learn platform routes | `packages/platform/src/studio/shipLearnRoutes.ts` |
| Case tabs / badges | `CaseTabStrip`, `ConfidenceBadge`, `BetCard`, `ComplexityBadge`, `EffortBreakdown`, `GroundingCard`, `SegmentCard` |
| Portfolio UI | `ScoreGauge`, `RecommendationBadge`, `SummaryChip`, `DecisionOption`, `ConfirmDialog` |
| Editable field | `packages/studio-web/components/EditableField.tsx` |
| Business Case Agent | `packages/agents/decide/business-case/` |
| Business Value Agent | `packages/agents/decide/value-engineering/` (`BusinessValueAgent` alias) |
| Engineering Effort Agent | `packages/agents/decide/solutions-estimation/` (`EngineeringEstimationAgent` alias) |
| GTM Strategy Agent | `packages/agents/decide/product-strategy/` (`GtmStrategyAgent` alias) |
| Portfolio Advisor Agent | `packages/agents/decide/portfolio-management/` (`PortfolioAdvisorAgent` alias) |
| Requirements Analyst Agent | `packages/agents/define/requirements-analyst/` (`RequirementsAnalystAgent`) |
| Domain Steward Agent | `packages/agents/define/domain-steward/` (`DomainStewardAgent`) |
| Solutions Architect Agent | `packages/agents/define/solutions-architect/` (`SolutionsArchitectAgent`) |
| Software Engineering Agent | `packages/agents/build/software-engineering/` (`SoftwareEngineeringAgent`) |
| Quality Engineering Agent | `packages/agents/build/quality-engineering/` (`QualityEngineeringAgent`) |
| Documentation Agent | `packages/agents/build/documentation/` (`DocumentationAgent`) |
| Ship agents | `packages/agents/ship/{devops,devsecops,finops,release-manager,deployment-engineer,sre}/` |
| Learn agents | `packages/agents/learn/{attribution-analyst,stakeholder-impact,organizational-learning,calibration}/` |

---

## Business Cases (Decide) — flow & routes

Entry: **Pain Points** → **Start working on this →** → `/business-cases/new?painPointId=&label=` → **Write the business case** → review `/business-cases/[featureId]` → **Send for sizing →** → tabs open.

| Platform (studio secret) | Next BFF |
|--------------------------|----------|
| `GET /studio/business-cases` | `GET /api/business-cases` |
| `GET /studio/business-cases/:id` | `GET /api/business-cases/:id` |
| `POST /studio/business-cases/generate` | `POST /api/business-cases/generate` |
| `PATCH /studio/business-cases/:id/field` | `PATCH /api/business-cases/:id/field` |
| `POST /studio/business-cases/:id/merge` | `POST /api/business-cases/:id/merge` |
| `POST /studio/business-cases/:id/dismiss-duplicate` | `POST /api/business-cases/:id/dismiss-duplicate` |
| `POST /studio/business-cases/:id/send` | `POST /api/business-cases/:id/send` |
| `GET /studio/business-cases/:id/value` | `GET /api/business-cases/:id/value` |
| `POST /studio/business-cases/:id/estimate-value` | `POST /api/business-cases/:id/estimate-value` |
| `POST /studio/business-cases/:id/value/adjust` | `POST /api/business-cases/:id/value/adjust` |
| `GET /studio/business-cases/:id/effort` | `GET /api/business-cases/:id/effort` |
| `POST /studio/business-cases/:id/estimate-effort` | `POST /api/business-cases/:id/estimate-effort` |
| `PATCH /studio/business-cases/:id/effort/risk-addressed` | `PATCH /api/business-cases/:id/effort/risk-addressed` |
| `POST /studio/business-cases/:id/effort/reestimate` | `POST /api/business-cases/:id/effort/reestimate` |
| `GET /studio/gtm` | `GET /api/gtm` |
| `GET /studio/gtm/:id` | `GET /api/gtm/:id` |
| `POST /studio/gtm/:id/plan` | `POST /api/gtm/:id/plan` |
| `PATCH /studio/gtm/:id/positioning` | `PATCH /api/gtm/:id/positioning` |
| `GET /studio/portfolio` | `GET /api/portfolio` |
| `GET /studio/portfolio/:id` | `GET /api/portfolio/:id` |
| `POST /studio/portfolio/:id/assemble` | `POST /api/portfolio/:id/assemble` |
| `POST /studio/portfolio/:id/decide` | `POST /api/portfolio/:id/decide` |
| `GET /studio/portfolio/awaiting` | `GET /api/portfolio/awaiting` |
| `GET /studio/decisions` | `GET /api/decisions` |
| `GET /studio/requirements` | `GET /api/requirements` |
| `GET /studio/requirements/:id` | `GET /api/requirements/:id` |
| `POST /studio/requirements/:id/draft` | `POST /api/requirements/:id/draft` |
| `GET /studio/domain` | `GET /api/domain` |
| `GET /studio/domain/:id` | `GET /api/domain/:id` |
| `POST /studio/domain/:id/draft` | `POST /api/domain/:id/draft` |
| `GET /studio/architecture` | `GET /api/architecture` |
| `GET /studio/architecture/:id` | `GET /api/architecture/:id` |
| `POST /studio/architecture/:id/draft` | `POST /api/architecture/:id/draft` |
| `GET /studio/build` | `GET /api/build` |
| `GET /studio/build/:id` | `GET /api/build/:id` |
| `POST /studio/build/:id/record` | `POST /api/build/:id/record` |
| `GET /studio/quality` | `GET /api/quality` |
| `GET /studio/quality/:id` | `GET /api/quality/:id` |
| `POST /studio/quality/:id/run` | `POST /api/quality/:id/run` |
| `GET /studio/docs` | `GET /api/docs` |
| `GET /studio/docs/:id` | `GET /api/docs/:id` |
| `POST /studio/docs/:id/draft` | `POST /api/docs/:id/draft` |
| `GET/POST /studio/builds…` | `GET/POST /api/builds…` |
| `GET/POST /studio/safety…` | `GET/POST /api/safety…` |
| `GET/POST /studio/release…` | `GET/POST /api/release…` |
| `GET/POST /studio/rollout…` | `GET/POST /api/rollout…` |
| `GET/POST /studio/outcomes…` | `GET/POST /api/outcomes…` |
| `GET/POST /studio/impact…` | `GET/POST /api/impact…` |
| `GET/POST /studio/lessons…` (+ `/close`) | `GET/POST /api/lessons…` |
| `GET /studio/loop/closed` | Home banner |
| `GET/POST /team/approvers` | `GET/POST /api/team/approvers` |
| `DELETE /team/approvers/:userId` | `DELETE /api/team/approvers/:userId` |

**Status tags (derived, full lifecycle):** Needs your review · Draft · Sizing in progress · Awaiting decision · ✓ Admitted · ↩ Deferred · ✗ Rejected  
**Board filters:** All · Needs your review · Being sized · Awaiting decision · Admitted (Deferred/Rejected via All only)  
**Home:** Approvers see “N business cases waiting on your decision” when packets await a gate.  
**Assemble notify:** When Settings → `notify_big_problems` is on, assembling a packet logs/emails each portfolio approver.  
**RBAC:** Viewers read-only; Admin/Editor can edit, merge, send, estimate, adjust, mark risks, and plan GTM.  
**UI language:** plain business words only — never show graph kinds, raw JSON, or LLM prompts.

### Go-to-Market (separate Decide nav item — not a case tab)

Sidebar: **Decide → Go-to-Market** → `/gtm` board → `/gtm/[featureId]` detail.

Depends on **Business Value** (sequential):

1. **Needs value first** — locked copy + link to `/business-cases/:id/value`
2. **Ready to plan** — **Plan the go-to-market**
3. **Planned** — positioning (editable), segment cards (fit / size / CAC / LTV), reach + differentiation

Board chip on Business Cases: `🎯 National toll concessionaires on MLFF` when GTM exists.

### Portfolio Review (separate Decide nav item — not a case tab)

Sidebar: **Decide → Portfolio Review** → `/portfolio` board → `/portfolio/[featureId]` detail.

Depends on **Value + Effort + GTM**:

1. **Needs assessments** — links to missing value / effort / `/gtm/:id`
2. **Ready to assemble** — **Assemble the packet for review**
3. **Ready for review** — value/risk gauges, muted system suggestion, summary chips, Admit / Defer / Reject (approvers only)
4. **Decided** — recorded decision + rationale

Admit locks `VALUE_HYPOTHESIS` nodes (`committed: true`). Approvers managed under **Team & Access → Portfolio approvers** (Hariprasad seeded as CPO).

### Sizing tabs (after Send for sizing)

Tabs on the case: **The Case** · **Business Value** · **Engineering Effort** — independent; neither waits on the other.

**Value screen**

- Always a **range** (Toll.OS in **INR**, e.g. `₹7.0M – ₹11.0M / year`; StaaS demo still EUR), never a single point
- Confidence: Fairly / Somewhat / Early guess + `(68%)`
- Bets lock on Admit (`committed: true`)
- Empty: “Let’s figure out what this is worth”

**Effort screen**

- Always a **weeks range** (`10 – 14 weeks` for Toll.OS), never a single week
- Complexity badge inverted vs confidence: low=green “Straightforward”, high=red “Highly complex”
- Risks with **Mark as handled** (strikethrough; range unchanged until **Re-estimate**)
- Breakdown bar + grounding cards (“Similar past changes”, “Rules that apply here”)
- Empty: “Let’s figure out how much work this is”

**Board:** side-by-side `₹7.0M–₹11.0M` and `10–14w` (or “not yet sized” independently).

Demo is exactly **two** cases:
1. *Toll.OS MLFF orchestration event metering (₹5/event)* — full path through Admit → Decision History (`₹7.0M–₹11.0M/yr`, `10–14w`)
2. *StaaS 3PL near-real-time warehouse inventory* — full path to packet, **Awaiting decision** (`€420K–€980K/yr`, `5–8w`)

---

## Demo members (Team & Access)

Only these two workspace members (legacy Sarah / Raj / Anita removed on seed & demo prepare):

| Name | Email | Role | Password |
|------|-------|------|----------|
| **Hariprasad** | `hariprasad@bosch-mps.com` | **admin** | `demo1234` |
| **Pradeep R** | `pradeep.r@bosch-mps.com` | **viewer** | `demo1234` |

- Admin sees Settings + Team & Access.
- Viewer does not.
- Demo bypass always opens as **Hariprasad (Admin)**.
- JWT/session refreshes `name` from DB so old “Sarah Kim” sessions migrate to Hariprasad.

---

## Demo content themes

Seeded via `POST /api/demo/prepare` → Platform `POST /studio/demo/seed-pain-points`:

- **MLFF tolling** (Delhi Multi-Lane Free Flow / MPS Road Services context)
- **MPS StaaS (Store as a Service)**

Pain-points list prefers rows with `metadata.demo=true` when demos exist.

---

## Run locally

```bash
# Platform (required) — DB on 5433
STUDIO_SECRET=avp-studio-dev-secret pnpm -F @avp/platform dev

# Studio UI — default :3000
pnpm -F @avp/studio-web dev

# If :3000 is already taken, use the next port:
pnpm -F @avp/studio-web run dev:3001
# → http://localhost:3001
```

Ensure `DEMO_BYPASS=1` in `packages/studio-web/.env.local`.

**Fastest demo path**

1. Open http://localhost:3001/login (or :3000 if that instance is the one you started)  
2. Click **Enter demo (no login)**  
3. Lands as Hariprasad (Admin) with Bosch branding + MLFF/StaaS pain points  
4. Sidebar → **Decide → Business Cases** → open *Toll.OS MLFF orchestration…*  
5. Tabs → **Business Value** / **Engineering Effort**, or sidebar → **Go-to-Market**  

Optional credential login: `hariprasad@bosch-mps.com` / `demo1234`.  
Viewer check: `pradeep.r@bosch-mps.com` / `demo1234` (read-only; no plan/edit actions).

---

## Env notes

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Default `postgresql://avp:avp_dev_password@localhost:5433/avp` |
| `STUDIO_SECRET` | Platform header `X-Studio-Secret` (dev: `avp-studio-dev-secret`) |
| `DEMO_BYPASS` | `1` enables Enter demo + demo NextAuth provider |
| `NEXTAUTH_SECRET` / `NEXTAUTH_URL` | Auth session |

---

## Deviations from the VOC guide

1. **DB port `5433`** (not 5432) — matches Part 1 Docker mapping.
2. **Studio → Platform auth** via `X-Studio-Secret` (Platform agent JWT still required for `/graph/*`).
3. **Dedicated studio read routes** (`/studio/stats`, `/studio/pain-points`) instead of bare `/graph/query`.
4. **Middleware** uses `getToken` (edge-safe); public `brand/` assets excluded from auth matcher.
5. **`@fastify/multipart@8`** for Fastify 4.
6. **SSO providers** only when client IDs are set; credentials + demo bypass for local demos.
7. **Branding & users** diverge from guide’s Sarah Kim / generic pink theme → Bosch MPS + Hariprasad / Pradeep R.

---

## Validation notes

**VoC (Prompt 12)**

- Settings PATCH `weeklySummaryEmail: false` persisted
- Intercom connector Connected persisted
- CSV ingest → pain points created
- Invite flow exercised
- Unauthenticated `/` → redirect `/login`

**Business Cases (Prompt 8)**

- Seeded demo case: *Toll.OS MLFF orchestration event metering (₹5/event)* (Admitted)
- Field PATCH persists `customerSegment` across reload
- Pain Points CTA navigates to `/business-cases/new`
- Generate creates BRIEF + FEATURE and returns `featureId`
- Viewer (Pradeep R) cannot PATCH/send (403 from Next BFF)

**Business Value (Prompt 8)**

- Demo case shows tabs + `₹7.0M–₹11.0M` range (₹5/event), Somewhat confident (68%), three bets locked after Admit
- Adjust assumptions re-runs estimate with edited text
- Board shows inline value range for sized cases
- Fresh cases without assessment show the honest trigger CTA

**Engineering Effort (Prompt 8)**

- Demo case shows `6–9 weeks`, Moderately complex, team of 2, two risks, breakdown bar
- Mark risk handled → strikethrough + re-estimate banner; weeks unchanged until Re-estimate
- Board shows value + effort side by side
- Effort tab works even when Value has not been estimated yet

**Go-to-Market**

- Separate Decide nav (not a 4th case tab)
- Demo plan: Strong fit “National toll concessionaires on MLFF”, high fit regional operators
- Locked state when value missing; positioning editable for admin/editor
- Business Cases board shows top-segment chip

**Portfolio Review**

- Separate Decide nav (not a 5th case tab)
- Demo packet: Value 78 / Risk 44, Admitted (Decision History)
- Hariprasad is a seeded portfolio approver (CPO); Pradeep sees read-only gate
- Admit confirmation lists hypotheses before lock-in
- Post-decision result copy (Admit → Define / Defer → Listen / Reject → closed)

**Decide closing**

- Business Cases board reflects end-to-end lifecycle (not stuck on “Sent for sizing”)
- Decision History audit log under Decide
- Home banner for approvers with awaiting packets
- Approver notify hook on packet assemble (Settings toggle)

**Define — Requirements**

- Sidebar **Define → Requirements** → `/requirements` → `/requirements/[featureId]`
- Board lists only **Admitted** cases (Toll.OS shows; StaaS awaiting does not)
- Statuses: `Needs requirements` | `Stories drafted`
- Seeded Toll.OS: 4 MLFF / ₹5-event stories, 2 ACs each (`REFINES` / `ACCEPTS`)
- Detail CTA **Draft the requirements** when empty (Admin/Editor); viewers read-only
- Locked copy + Portfolio Review link when case is not admitted

**Define — Domain Model**

- Sidebar **Define → Domain Model** → `/domain` → `/domain/[featureId]`
- Statuses: `Needs domain model` | `Domain modeled`
- Seeded Toll.OS: concepts (event / ANPR / RFID / LiDAR), KPIs, privacy regulation, ₹5 + idempotency rules
- Soft lock until stories exist; CTA **Draft the domain model**

**Define — Architecture**

- Sidebar **Define → Architecture** → `/architecture` → `/architecture/[featureId]`
- Statuses: `Needs architecture` | `Architecture proposed`
- Seeded Toll.OS: Sensor Fusion → Exception Orchestration → Event Metering → Billing Ledger + interfaces
- Draft requires stories; CTA **Propose the architecture**

**Build — Implementation / Quality / Docs**

- Sidebar **Build → Implementation** `/build`, **Quality** `/quality`, **Docs** `/docs`
- Implementation requires architecture; Quality & Docs require an implementation note
- Seeded Toll.OS: MLFF changeset (4 files), quality gate passed (4 fixtures), docs + changelog
- QA `BUILD` now links to feature via `VERIFIES` + `source: quality-engineering` (Ship gate)
- CTAs: **Record the implementation** · **Run quality checks** · **Draft the docs**

**Ship + Learn (full loop)**

- Ship: Builds → Safety → Release → Rollout (Toll.OS seeded to Healthy in production)
- Learn: Outcomes judged → Impact assessed → Lessons → **Cycle closed**
- Home banner when closed cycles exist; calibration written for value-engineering (~2% error)
- StaaS still awaiting Admit — absent from Ship/Learn boards

---

## Define — Requirements

Sidebar: **Define → Requirements** → `/requirements` board → `/requirements/[featureId]` detail.

Depends on **Portfolio Admit**:

1. **Not admitted** — locked copy + link to `/portfolio/:id`
2. **Needs requirements** — **Draft the requirements** (runs `RequirementsAnalystAgent`)
3. **Stories drafted** — plain-language stories + checklist ACs; **Draft again** for Admin/Editor

Demo seed (Toll.OS only after Admit): meter ANPR @ ₹5, fuse RFID+ANPR, LiDAR exception → orchestration, idempotent ₹5 ledger.

**RBAC:** Viewers read-only; Admin/Editor can draft.

### Domain Model

Sidebar: **Define → Domain Model** → `/domain` → `/domain/[featureId]`.

1. **Not admitted** → Portfolio Review  
2. **No stories** → Requirements  
3. **Needs domain model** → **Draft the domain model** (`DomainStewardAgent`)  
4. **Domain modeled** — concepts, KPIs, rules, regulations

### Architecture

Sidebar: **Define → Architecture** → `/architecture` → `/architecture/[featureId]`.

1. **Not admitted** → Portfolio Review  
2. **No stories** → Requirements  
3. **Needs architecture** → **Propose the architecture** (`SolutionsArchitectAgent`)  
4. **Architecture proposed** — bounded contexts + service interfaces

---

## Build — Implementation / Quality / Docs

Admitted cases only (Toll.OS demo; StaaS awaiting stays off the boards).

### Implementation

Sidebar: **Build → Implementation** → `/build` → `/build/[featureId]`.

1. **Not admitted** → Portfolio Review  
2. **No architecture** → Architecture  
3. **Needs implementation** → **Record the implementation** (`SoftwareEngineeringAgent`)  
4. **Implementation recorded** — notes, risk, files touched

### Quality

Sidebar: **Build → Quality** → `/quality` → `/quality/[featureId]`.

1. **No implementation** → Implementation  
2. **Needs quality check** → **Run quality checks** (`QualityEngineeringAgent`)  
3. **Quality passed** / **Quality blocked** — suite cases + run summary

### Docs

Sidebar: **Build → Docs** → `/docs` → `/docs/[featureId]`.

1. **No implementation** → Implementation  
2. **Needs docs** → **Draft the docs** (`DocumentationAgent`)  
3. **Docs drafted** — outline + changelog

**RBAC:** Viewers read-only; Admin/Editor can record, run, and draft.

---

## Ship — Builds / Safety / Release / Rollout

Admitted + quality-passed cases. Toll.OS demo is fully seeded through production health.

| Surface | Path | Statuses | CTA / agent |
|---------|------|----------|-------------|
| Builds | `/builds` | Needs quality pass · Needs pipeline build · Build recorded | **Record the pipeline build** (`DevOpsAgent`) |
| Safety | `/safety` | Needs pipeline build · Needs safety checks · Safety cleared/blocked | **Run safety checks** (DevSecOps + FinOps) |
| Release | `/release` | Needs readiness · Awaiting sign-off · Release approved | **Check readiness** + **Approve release** (`ReleaseManagerAgent` + `RELEASE_GATE`) |
| Rollout | `/rollout` | Needs rollout · Deployed — watch metrics · Healthy | **Record rollout** + **Check health** (Deployment + SRE) |

---

## Learn — Outcomes / Impact / Lessons (+ close loop)

| Surface | Path | Statuses | CTA / agent |
|---------|------|----------|-------------|
| Outcomes | `/outcomes` | Needs live metrics · Needs outcomes · Outcomes judged | **Judge the outcomes** (`AttributionAnalystAgent`) |
| Impact | `/impact` | Needs outcomes first · Needs impact · Impact assessed | **Assess impact** (`StakeholderImpactAgent`) |
| Lessons | `/lessons` | Needs lessons · Lessons captured · **Cycle closed** | **Capture lessons** + **Close the loop** (Org Learning + Calibration) |

**Close the loop:** `POST /studio/lessons/:id/close` captures lessons (if needed), calibrates value estimate vs realized (₹9.0M → ₹9.2M), sets cycle `DONE`, marks `feature.metadata.cycleClosed`, writes a loop-back `LEARNING` with `feedsListen: true`. Home shows “N cycles closed — lessons ready…” → `/lessons`.

Demo Toll.OS ends as **Cycle closed** so the full Listen→…→Learn loop is visible.

---

## Sidebar structure (full loop)

```
Home
Listen
  Add Feedback
  Pain Points
Decide
  Business Cases
  Go-to-Market
  Portfolio Review
  Decision History
Define
  Requirements
  Domain Model
  Architecture
Build
  Implementation
  Quality
  Docs
Ship
  Builds
  Safety
  Release
  Rollout
Learn
  Outcomes
  Impact
  Lessons
Settings / Team & Access   (admin only)
```

---

## Tagging tip for future chats

Attach or `@`-mention this file and say e.g.:

> Match UI to `studio_implementation.md` (Bosch MPS tokens, logo, sidebar/login patterns). Keep Hariprasad admin + Pradeep R viewer. The product loop is Listen → Decide → Define → Build → Ship → Learn.

Do not invent a new palette; reuse `bosch.*` / `pink` (Bosch-red) tokens and the embedded logo under `/brand/bosch-logo.svg`.
