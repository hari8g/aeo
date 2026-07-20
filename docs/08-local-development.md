# Local development

## Ports

| Service | Port |
|---------|------|
| Studio (Next) | **3001** (`pnpm run dev:3001`) |
| Platform API | **7070** |
| Postgres | **5433** (mapped; not 5432) |
| Prometheus (optional) | 9464 metrics |

## Environment

### Platform

```bash
STUDIO_SECRET=avp-studio-dev-secret
DATABASE_URL=postgresql://avp:avp_dev_password@localhost:5433/avp
# Optional:
ANTHROPIC_API_KEY=...   # without this, LLM stub is used
```

Example file: `packages/platform/.env.example`

### Studio (`packages/studio-web/.env.local` — gitignored)

Typical keys:

```bash
PLATFORM_URL=http://localhost:7070
STUDIO_SECRET=avp-studio-dev-secret
DEMO_BYPASS=1
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3001
```

## Common commands

```bash
# Infra
cd deploy/docker && docker compose up -d

# Install / build
pnpm install
pnpm -F @avp/shared build
pnpm -r --filter './packages/agents/**' build
pnpm -F @avp/platform build

# Seed demo graph
pnpm -F @avp/platform db:seed

# Dev servers
STUDIO_SECRET=avp-studio-dev-secret pnpm -F @avp/platform dev
pnpm -F @avp/studio-web run dev:3001
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `EADDRINUSE :7070` | Kill old `tsx watch src/server.ts` / `lsof -tiTCP:7070 \| xargs kill` |
| Studio BFF 401 | Sign in (demo) — unauthenticated `/api/*` returns Unauthorized |
| Lessons 500 DISTINCT/ORDER BY | Fixed in `shipLearnRoutes.ts` — pull latest |
| Empty boards after seed | Confirm Platform points at DB on 5433; re-run `db:seed` |
| pnpm requires Node 22 | Use Node 20.x with pnpm 9 via `npx pnpm@9` if global pnpm is too new |

## Demo users

| Email / login | Password | Role |
|---------------|----------|------|
| Hariprasad (demo admin) | `demo1234` | admin |
| Pradeep R | `demo1234` | viewer |
