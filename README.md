# AEO — Agentic Enterprise Orchestration

**Repository:** [github.com/hari8g/aeo](https://github.com/hari8g/aeo.git)  
**Product UI:** Bosch MPS **Customer Insights** Studio  
**Status:** Full closed loop — Listen → Decide → Define → Build → Ship → Learn  

AEO is a monorepo that runs an **agentic product operating system**: human-readable Studio boards on top of a graph-backed Platform API and a fleet of domain agents. The reference demo is **Bosch Mobility Platform & Solutions (MPS)** — Toll.OS MLFF event metering at **₹5/event (INR)** plus a StaaS 3PL case awaiting portfolio decision.

---

## Why this exists

Most “AI for product” demos stop at chat. AEO models the **whole product lifecycle** as durable graph nodes and edges, with:

1. **Studio** — role-aware boards (Admin / Editor / Viewer) in Bosch red UI  
2. **Platform** — Fastify API, Postgres graph, cycles, calibration, studio BFF auth  
3. **Agents** — Listen / Decide / Define / Build / Ship / Learn specialists that write typed graph artifacts  
4. **Loop close** — Learn calibrates predictions, marks the cycle `DONE`, and feeds the next Listen pass  

---

## Quick start

### Prerequisites

- Node.js 20+  
- [pnpm](https://pnpm.io) 9.x  
- **Postgres** (local install **or** Docker). Redis/NATS optional for Studio demo.  

### 1. Database (pick one)

**A) Local Postgres (Windows / no Docker)**

```powershell
# From repo root — creates role avp / db avp and writes packages/platform/.env
.\deploy\local-postgres\setup.ps1 -PgPassword "YOUR_POSTGRES_SUPERUSER_PASSWORD"
```

Defaults: `localhost:5432`, user/password `avp` / `avp_dev_password`.  
If `psql` is not on PATH, add e.g. `C:\Program Files\PostgreSQL\16\bin`.

**B) Docker Compose**

```bash
cd deploy/docker
docker compose up -d
# Then set DB_PORT=5433 in packages/platform/.env (see .env.example)
```

### 2. Install & seed

```bash
pnpm install
pnpm -F @avp/shared build
pnpm -r --filter './packages/agents/**' build
pnpm -F @avp/platform build
pnpm -F @avp/platform db:seed
```

Demo users (password for all: `demo1234`):

| User | Role |
|------|------|
| Hariprasad | Admin (+ portfolio approver / CPO) |
| Pradeep R | Viewer |

### 3. Run Platform + Studio

```bash
# Terminal A — Platform API (:7070)
STUDIO_SECRET=avp-studio-dev-secret pnpm -F @avp/platform dev

# Terminal B — Studio (:3001)
cd packages/studio-web
# Ensure .env.local has PLATFORM_URL / STUDIO_SECRET / DEMO_BYPASS=1
pnpm run dev:3001
```

Open **http://localhost:3001** → Enter demo as Hariprasad.

---

## Monorepo layout

```
packages/
  studio-web/          Next.js Customer Insights UI (Bosch MPS brand)
  platform/            Fastify Platform API, graph DB, studio routes, seed
  shared/              Graph kinds, HTTP adapter, shared types
  agents/
    listen/            VoC intelligence
    decide/            Business case, value, effort, GTM, portfolio
    define/            Requirements, domain steward, solutions architect
    build/             Software eng, quality, documentation
    ship/              DevOps, DevSecOps, FinOps, release, deploy, SRE
    learn/             Attribution, stakeholder impact, org learning, calibration
  runtimes/            Runtime helpers
deploy/docker/         Local infra (Postgres 5433, NATS, Redis, …)
docs/                  Phase-by-phase documentation (this tree)
dot_md/                Longer implementation / AOP planning notes
```

Workspace name in `package.json` remains `avp`; GitHub remote is **aeo**.

---

## Product loop (sidebar)

| Phase | Nav | What you do |
|-------|-----|-------------|
| **Listen** | Add Feedback, Pain Points | Ingest VoC; cluster pains |
| **Decide** | Business Cases, GTM, Portfolio, Decision History | Case → value → effort → GTM → admit/defer/reject |
| **Define** | Requirements, Domain Model, Architecture | Stories/ACs → concepts/KPIs → bounded contexts |
| **Build** | Implementation, Quality, Docs | Changeset → QA gate → docs/changelog |
| **Ship** | Builds, Safety, Release, Rollout | Pipeline → sec+cost → readiness+gate → deploy+SLIs |
| **Learn** | Outcomes, Impact, Lessons | Judge KPIs → stakeholder impact → lessons + **close loop** |

Detailed write-ups live under [`docs/`](./docs/).

---

## Demo data (after seed)

1. **Toll.OS MLFF orchestration event metering (₹5/event)**  
   - Full path through Admit → Define → Build → Ship → Learn  
   - Cycle stage **DONE**, `cycleClosed: true`  
   - Value band **₹7.0M–₹11.0M/yr** (INR)  

2. **StaaS 3PL near-real-time warehouse inventory**  
   - Packet assembled, **Awaiting decision**  
   - Value band **€420K–€980K/yr** (EUR — European logistics demo)  

UI brand reference: [bosch-mps.com](https://www.bosch-mps.com/en/home).

---

## Documentation map

| Doc | Contents |
|-----|----------|
| [docs/01-architecture.md](./docs/01-architecture.md) | System architecture, graph model, agents, cycles |
| [docs/02-listen.md](./docs/02-listen.md) | VoC / pain points |
| [docs/03-decide.md](./docs/03-decide.md) | Business case → portfolio gate |
| [docs/04-define.md](./docs/04-define.md) | Requirements, domain, architecture |
| [docs/05-build.md](./docs/05-build.md) | Implementation, quality, docs |
| [docs/06-ship.md](./docs/06-ship.md) | Builds, safety, release, rollout |
| [docs/07-learn.md](./docs/07-learn.md) | Outcomes, impact, lessons, loop close |
| [docs/08-local-development.md](./docs/08-local-development.md) | Env vars, ports, troubleshooting |
| [docs/09-demo-data-and-tollos.md](./docs/09-demo-data-and-tollos.md) | Toll.OS ₹5/event narrative & seed |
| [docs/10-api-routes.md](./docs/10-api-routes.md) | Platform `/studio/*` ↔ Next BFF map |
| [studio_implementation.md](./studio_implementation.md) | Bosch UI tokens, routes, validation checklist |
| Cursor phase guides (`*_studio_cursor_guide.md`) | Longer product prompts used while building |

---

## Auth & RBAC

- Studio uses NextAuth (credentials + optional SSO).  
- `DEMO_BYPASS=1` enables one-click demo login.  
- Platform studio routes expect header `X-Studio-Secret`.  
- **Viewers** read-only; **Admin/Editor** can draft, estimate, admit, record builds, close the loop.

---

## Tech stack

| Layer | Stack |
|-------|--------|
| Studio | Next.js App Router, Tailwind, NextAuth, Lucide |
| Platform | Fastify, Postgres (`graph_nodes` / `graph_edges`), Redis, NATS |
| Agents | TypeScript workspace packages, LLM gateway (stub without API key) |
| Tooling | pnpm workspaces, Turbo, Docker Compose |

---

## Development tips

- Prefer **plain business language** in the UI (never show raw graph kinds to end users).  
- Match UI to `studio_implementation.md` (Bosch red `#E20015`, Inter, board+detail pattern).  
- After schema/seed changes: `pnpm -F @avp/platform db:seed`.  
- If port 7070 is stuck: kill the old `tsx watch src/server.ts` process and restart Platform.

---

## License / ownership

Private / team use unless otherwise stated by the repository owner ([hari8g/aeo](https://github.com/hari8g/aeo)).
