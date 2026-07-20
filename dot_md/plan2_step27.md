# Plan 2 — Step 27 Implementation Record

**Date**: 2026-07-16  
**Plan source**: `aop_implementation_plan_p2.md` (STEP 27 — Observability)  
**Status**: Complete  

---

## 1. Objective

Initialize OpenTelemetry for `avp-platform`, export traces to Jaeger (OTLP), and expose Prometheus metrics on `:9464`.

## 2. Files changed

- `packages/platform/src/telemetry/index.ts` (new) — `initTelemetry`, `withSpan`, `createPlatformMetrics`, `shutdown`
- `packages/platform/src/server.ts` — early `initTelemetry()`, wrap graph write / LLM / register / cycles with metrics+spans, `SIGTERM` shutdown
- `packages/platform/package.json` — OTEL deps pinned to 0.53 / 1.26 line for compatibility
- `deploy/docker/prometheus.yml` — scrape `host.docker.internal:9464`

## 3. How it was done

`NodeSDK` with `metricReader: PrometheusExporter({ port: 9464 })`. Counters include `avp.graph.writes.total` (Prometheus name `avp_graph_writes_total`). OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; otherwise console spans.

## 4. Verification

- `/health` OK
- `curl :9464/metrics` lists `avp_graph_writes_total`
- Graph writes increment the counter with `agentId` / `kind` labels

## 5. Deviations

- OTEL package versions pinned to avoid sdk-node 0.53 vs metrics 2.x type conflicts
- `calibrationErrorPct` implemented as histogram (not ObservableGauge)
- Bootstrap counter sample `add(0)` so series appear before first write

## 6. Unlocks

Production scrape configs and Step 29 k8s prometheus annotations.
