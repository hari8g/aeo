import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node'
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus'
import { metrics, trace } from '@opentelemetry/api'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'

let sdk: NodeSDK | null = null
let promExporter: PrometheusExporter | null = null

export function initTelemetry(): void {
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT

  const traceExporter = otlpEndpoint
    ? new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` })
    : new ConsoleSpanExporter()

  promExporter = new PrometheusExporter({ port: 9464 }, () => {
    console.log('[Telemetry] Prometheus scrape endpoint :9464/metrics')
  })

  sdk = new NodeSDK({
    serviceName: 'avp-platform',
    traceExporter,
    metricReader: promExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  })
  sdk.start()

  console.log('[Telemetry] OpenTelemetry initialized for avp-platform')
}

export const tracer = () => trace.getTracer('avp-platform', '1.0.0')
export const meter = () => metrics.getMeter('avp-platform', '1.0.0')

export async function withSpan<T>(
  name: string,
  attrs: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer().startActiveSpan(name, { attributes: attrs }, async (span) => {
    try {
      const result = await fn()
      span.end()
      return result
    } catch (err) {
      span.recordException(err as Error)
      span.setStatus({ code: 2, message: String(err) })
      span.end()
      throw err
    }
  })
}

export function currentTraceId(): string {
  return trace.getActiveSpan()?.spanContext().traceId ?? 'no-trace'
}

export function createPlatformMetrics() {
  const m = meter()
  const metricsSet = {
    graphWritesTotal: m.createCounter('avp.graph.writes.total', {
      description: 'Total graph writes',
    }),
    graphWriteErrors: m.createCounter('avp.graph.write.errors', {
      description: 'Rejected writes (policy)',
    }),
    agentRegistrations: m.createCounter('avp.agents.registrations', {
      description: 'Agent registrations',
    }),
    verdictValidated: m.createCounter('avp.verdicts.validated', {
      description: 'Hypotheses validated',
    }),
    verdictRefuted: m.createCounter('avp.verdicts.refuted', {
      description: 'Hypotheses refuted',
    }),
    cyclesStarted: m.createCounter('avp.cycles.started', { description: 'Cycles started' }),
    cyclesCompleted: m.createCounter('avp.cycles.completed', {
      description: 'Cycles completed',
    }),
    gateWaitSeconds: m.createHistogram('avp.gates.wait_seconds', {
      description: 'Seconds a human gate waited',
    }),
    llmTokensUsed: m.createHistogram('avp.llm.tokens_used', {
      description: 'LLM tokens per agent run',
    }),
    calibrationErrorPct: m.createHistogram('avp.calibration.error_pct', {
      description: 'Prediction error % samples',
    }),
  }
  // Force registration so /metrics lists series before first real write
  metricsSet.graphWritesTotal.add(0, { agentId: 'bootstrap', kind: 'none' })
  return metricsSet
}

export async function shutdown(): Promise<void> {
  await sdk?.shutdown()
  await promExporter?.shutdown()
}
