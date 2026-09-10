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
4. **Office** — isometric Studio surface at `/office` (department pods + live knowledge graph)  
5. **Loop close** — Learn calibrates predictions, marks the cycle `DONE`, and feeds the next Listen pass  

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

**Windows:** use PowerShell and follow [Windows: install, run, and start](#windows-install-run-and-start) below. Do not copy the Unix `STUDIO_SECRET=...` prefix into PowerShell.

---

## Windows: install, run, and start

This is the full path from a clean Windows 10/11 PC to a running Studio + Office. Use **PowerShell** (not Command Prompt) from the **repository root** unless a step says otherwise.

### What you will have running

| Piece | Address | What it is |
|-------|---------|------------|
| Platform API | http://localhost:7070 | Graph, seed data, studio BFF backend |
| Studio | http://localhost:3001 | Bosch MPS Customer Insights UI |
| Office | http://localhost:3001/office | 3D department floor |
| Postgres | `localhost:5432` | Local database (no Docker required) |

Redis and NATS are **optional**. Without them, Platform uses in-memory working memory and still serves Studio.

### 0. Prerequisites

Install these **before** cloning, then **close and reopen PowerShell** so `PATH` updates apply.

1. **Git for Windows** — [git-scm.com/download/win](https://git-scm.com/download/win). Keep “Git from the command line” enabled.
2. **Node.js 20 LTS** — [nodejs.org](https://nodejs.org/) (20.x, not 18). Confirm:
   ```powershell
   node -v    # v20.x or newer
   ```
3. **pnpm 9** — after Node is installed:
   ```powershell
   corepack enable
   corepack prepare pnpm@9.15.0 --activate
   pnpm -v    # 9.x
   ```
   If Corepack is blocked, `npm install -g pnpm@9` works too.
4. **PostgreSQL 15 or 16** — [enterprisedb.com/downloads](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads). During setup:
   - Remember the **postgres** superuser password (you need it for the script below).
   - Accept the default port **5432**.
   - Add `C:\Program Files\PostgreSQL\16\bin` (or `\15\bin`) to your user **PATH**, or the setup script will look there automatically.
5. **Allow PowerShell scripts** (once per machine, if you get an execution-policy error):
   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
   ```

Docker Desktop is **not** required for the Studio demo.

### 1. Clone the repo

```powershell
cd $HOME\Desktop
git clone https://github.com/hari8g/aeo.git
cd aeo
```

All later commands assume this folder is the current directory (the folder that contains `pnpm-workspace.yaml` and `deploy\`).

### 2. Create the database and env files

```powershell
.\deploy\local-postgres\setup.ps1 -PgPassword "YOUR_POSTGRES_SUPERUSER_PASSWORD"
```

Replace the password with the one you set when installing PostgreSQL.

What the script does:

- Finds `psql` on `PATH` or under `C:\Program Files\PostgreSQL\1x\bin`
- Creates (or updates) role `avp` / password `avp_dev_password`
- Creates database `avp` owned by that role
- Writes `packages\platform\.env` (API port 7070 + DB + `STUDIO_SECRET`)
- Writes `packages\studio-web\.env.local` if it does not already exist (`PLATFORM_URL`, `DEMO_BYPASS=1`, NextAuth)

If `psql` is missing:

```powershell
$env:Path += ";C:\Program Files\PostgreSQL\16\bin"
.\deploy\local-postgres\setup.ps1 -PgPassword "YOUR_POSTGRES_SUPERUSER_PASSWORD"
```

Other useful flags: `-DbPort 5432`, `-PgUser postgres`, `-PgHost localhost`.

### 3. Install packages and build

```powershell
pnpm install
pnpm -F @avp/shared build
pnpm -r --filter "./packages/agents/**" build
pnpm -F @avp/platform build
pnpm -F @avp/office-view build
```

Notes:

- Use **double quotes** around the agents filter in PowerShell (`"./packages/agents/**"`). Single quotes also work; do not omit the quotes.
- `@avp/platform build` runs `tsc` then copies `schema.sql`. If that `cp` step fails under `cmd.exe`, you can skip it: `db:seed` and `dev` run TypeScript via `tsx` and do not need `dist\`.
- Office (`/office`) needs the `@avp/office-view` bundle at least once. Studio’s production `prebuild` also runs it.

### 4. Seed demo data

```powershell
pnpm -F @avp/platform db:seed
```

This loads graph nodes, demo users, Toll.OS + StaaS cases, and the office in-progress topics.

| Login name | Password | Role |
|------------|----------|------|
| Hariprasad | `demo1234` | Admin |
| Pradeep R | `demo1234` | Viewer |

### 5. Start the app (two PowerShell windows)

**Window A — Platform API** (keep this open):

```powershell
cd $HOME\Desktop\aeo
$env:STUDIO_SECRET = "avp-studio-dev-secret"
pnpm -F @avp/platform dev
```

Wait until you see the server listening on **7070**. A health check:

```powershell
Invoke-RestMethod http://localhost:7070/health
```

**Window B — Studio UI** (keep this open):

```powershell
cd $HOME\Desktop\aeo\packages\studio-web
pnpm run dev:3001
```

Confirm `packages\studio-web\.env.local` contains:

```
PLATFORM_URL=http://localhost:7070
STUDIO_SECRET=avp-studio-dev-secret
DEMO_BYPASS=1
NEXTAUTH_URL=http://localhost:3001
NEXTAUTH_SECRET=dev-local-secret-change-me
```

### 6. Open the product

1. Browser: **http://localhost:3001**
2. Click **Enter demo** (or sign in as **Hariprasad** / `demo1234`)
3. Office floor: **http://localhost:3001/office** (hard-refresh after rebuilding `@avp/office-view`)

Leave both windows running. Stop with `Ctrl+C` in each.

### 7. After you pull new code

```powershell
cd $HOME\Desktop\aeo
git pull
pnpm install
pnpm -F @avp/shared build
pnpm -r --filter "./packages/agents/**" build
pnpm -F @avp/platform db:seed
pnpm -F @avp/office-view build
```

Then start Window A and Window B again.

### Windows troubleshooting

| Symptom | What to do |
|---------|------------|
| `running scripts is disabled` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, then retry. |
| `psql not found` | Add `C:\Program Files\PostgreSQL\16\bin` to PATH, or pass the password after that. |
| `password authentication failed for user postgres` | Wrong `-PgPassword`. Use the password from the PostgreSQL installer. |
| `EADDRINUSE` on 7070 or 3001 | Find and kill the old process: `netstat -ano \| findstr :7070` then `taskkill /PID <pid> /F` (same for `:3001`). |
| Studio pages empty / API errors | Platform window must be up first. Check `STUDIO_SECRET` matches in both `.env` files. |
| `/office` is blank | Run `pnpm -F @avp/office-view build` and hard-refresh the browser. |
| `pnpm` wants Node 22 | Stay on Node 20 LTS and `corepack prepare pnpm@9.15.0 --activate`. |
| Seed or migrate cannot connect | Confirm Postgres service is running (`services.msc` → postgresql-x64-16) and `packages\platform\.env` has `DB_PORT=5432`. |

More env/port notes: [`docs/08-local-development.md`](./docs/08-local-development.md).

---

## Monorepo layout

```
packages/
  studio-web/          Next.js Customer Insights UI (Bosch MPS brand)
  office-view/         Three.js isometric office, bundled into studio-web/public/office
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
| **Office** | Office | 3D floor plan of the six MPS departments and the live graph — see [`packages/office-view/README.md`](./packages/office-view/README.md) |
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
