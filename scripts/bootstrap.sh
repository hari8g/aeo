#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "AVP Bootstrap"
echo "============="

command -v docker >/dev/null || { echo "Docker required"; exit 1; }
command -v pnpm   >/dev/null || { echo "pnpm required (npm i -g pnpm)"; exit 1; }
node --version | grep -E "^v2[0-9]" >/dev/null || { echo "Node.js 20+ required"; exit 1; }

if [ ! -f .env ]; then
cat > .env << 'EOF'
# Platform
PORT=7070
NODE_ENV=development

# Database (host maps Docker Postgres to 5433 — see deploy/docker)
DB_HOST=localhost
DB_PORT=5433
DB_NAME=avp
DB_USER=avp
DB_PASSWORD=avp_dev_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# NATS
NATS_URL=nats://localhost:4222

# LLM (set your key here)
ANTHROPIC_API_KEY=

# Observability
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Slack (optional — stub collaboration runtime used when empty)
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_DECISIONS_CHANNEL=#product-decisions
EOF
  echo ".env created — add your ANTHROPIC_API_KEY if desired"
fi

echo ""
echo "Starting infrastructure (PostgreSQL, Redis, NATS, Jaeger, Grafana)..."
(cd deploy/docker && docker compose up -d)
echo "Waiting for services to be healthy..."
sleep 8

echo ""
echo "Installing packages..."
pnpm install

echo ""
echo "Building packages..."
pnpm build

echo ""
echo "Running database migrations..."
pnpm -F @avp/platform db:migrate

echo ""
echo "AVP is ready."
echo ""
echo "  Platform API:    http://localhost:7070"
echo "  Platform health: http://localhost:7070/health"
echo "  Metrics:         http://localhost:9464/metrics"
echo "  Jaeger traces:   http://localhost:16686"
echo "  Grafana:         http://localhost:3100  (admin/admin)"
echo "  Prometheus:      http://localhost:9090"
echo ""
echo "  Start the platform:  pnpm -F @avp/platform dev"
echo "  Collab runtime:      pnpm -F @avp/collaboration-runtime dev"
echo ""
