# Plan 1 — Step 2 Implementation Record

**Date**: 2026-07-16  
**Plan source**: `aop_implementation_plan_p1.md` (STEP 2 — Docker Compose)  
**Status**: Complete and verified — all 7 services healthy  

---

## 1. Objective

Stand up the local infrastructure stack that the Agent Operating Platform (AOP) depends on before any Platform API or agent code runs. Step 2 delivers a Docker Compose environment with:

| Service | Role for AVP |
|---------|----------------|
| **PostgreSQL + pgvector** | Knowledge graph, agent registry, audit log, episodic memory, cycles |
| **Redis** | Working memory + rate limiting |
| **NATS JetStream** | Context bus for cross-agent events |
| **Jaeger** | Distributed tracing (OTLP collector + UI) |
| **Grafana** | Dashboards / observability UI |
| **Prometheus** | Metrics scrape + storage |
| **MinIO** | S3-compatible object storage for artifacts |

No application code was written in this step. Step 1 (`@avp/shared`) remains unchanged.

---

## 2. Starting state

After Step 1, the workspace had monorepo + `@avp/shared`, but:

- No `deploy/` directory
- No Docker Compose files
- No running infrastructure containers

**Host tooling used:**

| Tool | Version |
|------|---------|
| Docker | 28.1.1 |
| Docker Compose | v2.36.0-desktop.1 |

---

## 3. Files created

| Path | Purpose |
|------|---------|
| `deploy/docker/docker-compose.yml` | Full multi-service Compose definition |
| `deploy/docker/prometheus.yml` | Prometheus scrape config (required mount; not in plan snippet but referenced by it) |
| `plan1_step2.md` | This implementation record |

Final layout:

```
deploy/
└── docker/
    ├── docker-compose.yml
    └── prometheus.yml
```

---

## 4. How `docker-compose.yml` was built

### 4.1 Project name

```yaml
name: avp
```

Sets the Compose project name so containers/volumes are prefixed `avp-` / `avp_` (e.g. `avp-postgres-1`, volume `avp_pgdata`) instead of the default directory-derived name `docker`.

### 4.2 Service-by-service configuration

#### PostgreSQL (`postgres`)

- **Image**: `pgvector/pgvector:pg16` — Postgres 16 with the `vector` extension for semantic search on graph node embeddings (used in Step 3 schema).
- **Credentials** (dev only):
  - DB: `avp`
  - User: `avp`
  - Password: `avp_dev_password`
- **Port**: `5432:5432`
- **Volume**: `pgdata` → `/var/lib/postgresql/data`
- **Healthcheck**: `pg_isready -U avp` every 5s

Verified separately that `CREATE EXTENSION vector` works (extension version **0.8.5** on PostgreSQL **16.14**).

#### Redis (`redis`)

- **Image**: `redis:7-alpine`
- **Port**: `6379:6379`
- **Command**: `redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru`  
  Caps memory and evicts least-recently-used keys — appropriate for working-memory TTLs.
- **Healthcheck**: `redis-cli ping` → expects `PONG`

#### NATS (`nats`)

- **Image**: `nats:2.10-alpine`
- **Command** (final):
  ```yaml
  command: ['-js', '-sd', '/data', '-m', '8222']
  ```
  | Flag | Meaning |
  |------|---------|
  | `-js` | Enable JetStream (durable streams for context events) |
  | `-sd /data` | Persist JetStream state on the `natsdata` volume |
  | `-m 8222` | Enable HTTP monitoring (required for `/healthz`) |

- **Ports**: `4222` (client), `8222` (monitoring)
- **Volume**: `natsdata` → `/data`
- **Healthcheck**: `wget` against `http://127.0.0.1:8222/healthz`

#### Jaeger (`jaeger`)

- **Image**: `jaegertracing/all-in-one:1.58`
- **Env**: `COLLECTOR_OTLP_ENABLED=true` — accepts OTLP HTTP on port **4318**
- **Ports**:
  - `16686` — Jaeger UI
  - `4318` — OTLP HTTP collector (for Step 3 OpenTelemetry exporter)
- **Healthcheck**: admin endpoint on port `14269`

#### Grafana (`grafana`)

- **Image**: `grafana/grafana:11.0.0`
- **Port mapping**: host `3100` → container `3000` (avoids colliding with common local apps on 3000)
- **Admin password**: `admin` (`GF_SECURITY_ADMIN_PASSWORD`)
- **Volume**: `grafana` for dashboards/settings persistence
- **Healthcheck**: `http://localhost:3000/api/health`

#### Prometheus (`prometheus`)

- **Image**: `prom/prometheus:v2.53.0`
- **Port**: `9090:9090`
- **Config mount**: `./prometheus.yml` → `/etc/prometheus/prometheus.yml:ro`
- **Healthcheck**: `http://localhost:9090/-/healthy`

#### MinIO (`minio`)

- **Image**: `minio/minio`
- **Command**: `server /data --console-address ':9001'`
- **Credentials**: user `avp` / password `avp_dev_password`
- **Ports**: `9000` (S3 API), `9001` (web console)
- **Volume**: `miniodata`
- **Healthcheck**: `curl -f http://localhost:9000/minio/health/live`

### 4.3 Named volumes

```yaml
volumes:
  pgdata:
  natsdata:
  grafana:
  miniodata:
```

Persist data across `docker compose down` / `up` cycles (removed only with `-v`).

---

## 5. `prometheus.yml` (created because Compose mounts it)

The plan’s Compose file mounts `./prometheus.yml`, but the plan did not include the file contents. Without it, Prometheus fails to start.

**File**: `deploy/docker/prometheus.yml`

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: ['localhost:9090']

  - job_name: avp-platform
    metrics_path: /metrics
    static_configs:
      - targets: ['host.docker.internal:7070']
        labels:
          service: platform
```

- Scrapes Prometheus itself immediately.
- Pre-wires a future scrape of the Platform API on host port **7070** via `host.docker.internal` (Mac Docker Desktop). That target will stay down until Step 3; it does not block Prometheus health.

---

## 6. Deviations from the plan snippet (and why)

| Plan text | What we shipped | Why |
|-----------|-----------------|-----|
| `version: '3.9'` | Omitted | Obsolete in Compose V2; ignored if present |
| Healthcheck fields on one line (`interval: 5s; timeout: 5s`) | Proper multi-line YAML maps | Plan’s single-line form is invalid YAML |
| No project `name` | `name: avp` | Stable, readable container/volume names |
| NATS `command: -js -sd /data` | Added `-m 8222` | Without monitoring, port 8222 resets connections and healthchecks fail |
| Healthchecks only on postgres/redis | Healthchecks on all 7 services | Matches the plan’s verify goal: “all services should be healthy” |
| MinIO health unspecified | `curl` live endpoint | Reliable on the official MinIO image |
| No `prometheus.yml` | Added minimal scrape config | Required by the volume mount |

These are operational fixes so the stack actually reaches a healthy state; service set, images, ports, and credentials match the plan.

---

## 7. How it was brought up (commands and order)

Working directory for all Compose commands:

```bash
cd /Users/harig/Desktop/AVP/deploy/docker
```

### 7.1 First start (image pulls)

```bash
docker compose up -d
```

- Pulled all seven images (~4.5 minutes on first run).
- Created network + volumes + containers.
- Initial project name was directory-derived (`docker_*`) before `name: avp` was added.

### 7.2 NATS health fix

After first start, NATS showed **unhealthy**:

- Host `curl localhost:8222/healthz` → connection reset
- In-container wget → connection refused

**Root cause**: HTTP monitoring was not enabled (`-m 8222` missing).

**Fix**: updated NATS command, then:

```bash
docker compose up -d nats
```

NATS became **healthy**; `/healthz` returned `{"status":"ok"}` and `/jsz` confirmed JetStream active.

### 7.3 Project rename to `avp`

1. Added `name: avp` to Compose file.
2. Stopped the old project (still bound to ports):
   ```bash
   docker compose -p docker down
   ```
3. Started the renamed stack:
   ```bash
   docker compose up -d
   ```
4. Removed orphaned volumes from the first project name:
   ```bash
   docker volume rm docker_grafana docker_miniodata docker_natsdata docker_pgdata
   ```

---

## 8. Verification results

### 8.1 `docker compose ps` (final)

All seven containers **Up (healthy)**:

| Container | Image | Host ports |
|-----------|-------|------------|
| `avp-postgres-1` | `pgvector/pgvector:pg16` | 5432 |
| `avp-redis-1` | `redis:7-alpine` | 6379 |
| `avp-nats-1` | `nats:2.10-alpine` | 4222, 8222 |
| `avp-jaeger-1` | `jaegertracing/all-in-one:1.58` | 16686, 4318 |
| `avp-grafana-1` | `grafana/grafana:11.0.0` | 3100 |
| `avp-prometheus-1` | `prom/prometheus:v2.53.0` | 9090 |
| `avp-minio-1` | `minio/minio` | 9000, 9001 |

### 8.2 Endpoint / CLI probes

| Check | Command / URL | Result |
|-------|---------------|--------|
| Postgres ready | `docker compose exec postgres pg_isready -U avp` | accepting connections |
| Postgres + pgvector | `CREATE EXTENSION vector` | ok — `vector` **0.8.5** |
| Redis | `redis-cli ping` | `PONG` |
| NATS health | `http://localhost:8222/healthz` | `{"status":"ok"}` |
| NATS JetStream | `http://localhost:8222/jsz` | JetStream stats JSON present |
| Grafana | `http://localhost:3100/api/health` | `database: ok`, version 11.0.0 |
| Prometheus | `http://localhost:9090/-/healthy` | Healthy |
| MinIO | `http://localhost:9000/minio/health/live` | 200 |
| Jaeger UI | `http://localhost:16686/` | HTTP 200 |

### 8.3 Persistent volumes (final)

```
avp_grafana
avp_miniodata
avp_natsdata
avp_pgdata
```

---

## 9. Local access map (for developers)

| UI / API | URL | Notes |
|----------|-----|-------|
| Grafana | http://localhost:3100 | user `admin` / password `admin` |
| Prometheus | http://localhost:9090 | |
| Jaeger UI | http://localhost:16686 | |
| MinIO Console | http://localhost:9001 | user `avp` / password `avp_dev_password` |
| MinIO S3 API | http://localhost:9000 | |
| NATS client | `nats://localhost:4222` | |
| NATS monitor | http://localhost:8222 | |
| Postgres | `localhost:5432` | db/user `avp`, password `avp_dev_password` |
| Redis | `localhost:6379` | no password (dev) |
| OTLP HTTP | http://localhost:4318 | for Platform API traces (Step 3) |

---

## 10. Day-to-day commands

```bash
cd /Users/harig/Desktop/AVP/deploy/docker

# Start
docker compose up -d

# Status
docker compose ps

# Logs (one service)
docker compose logs -f postgres

# Stop (keep volumes)
docker compose down

# Stop and wipe data volumes (destructive)
docker compose down -v
```

---

## 11. What this unlocks

Step 3 (Platform API) can now connect to:

| Env (typical) | Points at |
|---------------|-----------|
| `DB_HOST=localhost` / port 5432 | Postgres + pgvector |
| `REDIS_HOST=localhost` / port 6379 | Redis working memory |
| `NATS_URL=nats://localhost:4222` | Context bus |
| OTLP exporter → `http://localhost:4318` | Jaeger |
| Future object storage → MinIO `:9000` | Artifacts |
| Future metrics → Prometheus scrape of `:7070` | Already preconfigured |

---

## 12. Explicitly out of scope for this step

Not done yet (by design):

- Platform API / schema migrations (Step 3)
- Production Compose / Kubernetes (later phases)
- Grafana dashboards / Prometheus alert rules beyond the base scrape file
- Securing credentials (dev passwords only)
- TLS / auth on Redis, NATS, MinIO

---

## 13. How to re-verify

```bash
cd /Users/harig/Desktop/AVP/deploy/docker
docker compose ps
# Expect all 7 services: Up (healthy)

docker compose exec -T postgres pg_isready -U avp
docker compose exec -T redis redis-cli ping
curl -sf http://localhost:8222/healthz
curl -sf http://localhost:3100/api/health
curl -sf http://localhost:9090/-/healthy
curl -sf http://localhost:9000/minio/health/live
curl -sf -o /dev/null -w "%{http_code}\n" http://localhost:16686/
```

---

## 14. Summary

Step 2 delivered a running, healthy local infrastructure stack under `deploy/docker/`: Postgres (pgvector), Redis, NATS JetStream (with monitoring), Jaeger, Grafana, Prometheus, and MinIO. The Compose file from the plan was made valid YAML, given healthchecks on every service, fixed for NATS monitoring (`-m 8222`), and paired with a required `prometheus.yml`. All services were started and probed successfully; the environment is ready for Step 3 (Platform API).
