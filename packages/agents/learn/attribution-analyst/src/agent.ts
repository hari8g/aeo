import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import { NODE_KINDS, EDGE_KINDS } from '@avp/shared'

export interface AttributionAnalystInput {
  featureId: number
  kpiActuals: Record<string, number>
  cycleId?: string
}

export interface AttributionAnalystOutput {
  verdictId: number
  outcomeIds: number[]
  summary: string
}

export const ATTRIBUTION_ANALYST_MANIFEST: AgentManifest = {
  id: 'attribution-analyst:v1',
  name: 'Attribution Analyst Agent',
  archetype: 'Value Attribution Analyst',
  domain: 'learn',
  runtime: 'studio',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [NODE_KINDS.HYPOTHESIS_VERDICT, NODE_KINDS.OUTCOME],
    edgeKinds: [EDGE_KINDS.ATTRIBUTES, EDGE_KINDS.REALIZED],
    requiresGate: false,
    maxWritesPerMinute: 60,
  },
  subscribes: ['context.ship.slo_evaluated', 'context.decide.portfolio_decision'],
  healthEndpoint: 'http://localhost:7092/health',
  llmBudget: { maxTokensPerRun: 4000, preferredModel: 'claude-sonnet-4-6' },
}

export class AttributionAnalystAgent extends BaseAgent {
  protected readonly agentId = 'attribution-analyst:v1'
  protected readonly domain = 'learn' as const

  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) {
    super(adapter, llm)
  }

  async run(input: AttributionAnalystInput): Promise<AttributionAnalystOutput> {
    if (input.featureId === undefined || !input.kpiActuals || Object.keys(input.kpiActuals).length === 0) {
      this.fail('run', new Error('featureId and kpiActuals are required'))
    }

    const sessionId = randomUUID()
    const inputHash = this.hashInput(input)

    const llm = await this.complete({
      model: 'claude-sonnet-4-6',
      maxTokens: 1500,
      messages: [{
        role: 'user',
        content: `Attribute outcomes for feature ${input.featureId} given KPI actuals: ${JSON.stringify(input.kpiActuals)}.
Return JSON ONLY: {"verdict":"...","summary":"...","outcomes":[{"kpi":"...","value":0,"label":"..."}]}`,
      }],
    })

    const draft = this.parse(llm.text, input.kpiActuals)

    const verdictId = await this.writeNode({
      kind: NODE_KINDS.HYPOTHESIS_VERDICT,
      label: draft.verdict,
      description: draft.summary,
      metadata: { featureId: input.featureId, kpiActuals: input.kpiActuals },
      eventKind: 'verdict_recorded',
      cycleId: input.cycleId,
      featureId: input.featureId,
    })

    await this.writeEdge(verdictId, input.featureId, EDGE_KINDS.ATTRIBUTES)

    const outcomeIds: number[] = []
    for (const outcome of draft.outcomes) {
      const oid = await this.writeNode({
        kind: NODE_KINDS.OUTCOME,
        label: outcome.label,
        description: `${outcome.kpi}=${outcome.value}`,
        metadata: { kpi: outcome.kpi, value: outcome.value, featureId: input.featureId },
        eventKind: 'outcome_recorded',
        cycleId: input.cycleId,
        featureId: input.featureId,
      })
      outcomeIds.push(oid)
      await this.writeEdge(verdictId, oid, EDGE_KINDS.REALIZED)
    }

    await this.adapter.episodicMemory.write({
      agentId: this.agentId,
      sessionId,
      domain: 'learn',
      cycleId: input.cycleId,
      featureId: input.featureId,
      inputHash,
      inputSummary: `feature=${input.featureId} kpis=${Object.keys(input.kpiActuals).join(',')}`,
      outputSummary: draft.summary,
      outputNodeIds: [verdictId, ...outcomeIds],
      confidencePct: 75,
      llmTokensUsed: llm.tokensUsed.output,
    })

    return { verdictId, outcomeIds, summary: draft.summary }
  }

  private parse(raw: string, kpiActuals: Record<string, number>) {
    const fallbackOutcomes = Object.entries(kpiActuals).map(([kpi, value]) => ({
      kpi,
      value,
      label: `${kpi}: ${value}`,
    }))
    try {
      const s = raw.indexOf('{')
      const e = raw.lastIndexOf('}')
      if (s >= 0 && e > s) {
        const p = JSON.parse(raw.slice(s, e + 1)) as {
          verdict?: string
          summary?: string
          outcomes?: Array<{ kpi?: string; value?: number; label?: string }>
        }
        return {
          verdict: p.verdict ?? 'Value realized',
          summary: p.summary ?? 'Attribution verdict from KPI actuals',
          outcomes: p.outcomes?.length
            ? p.outcomes.map((o) => ({
                kpi: o.kpi ?? 'kpi',
                value: Number(o.value ?? 0),
                label: o.label ?? `${o.kpi ?? 'kpi'}: ${o.value ?? 0}`,
              }))
            : fallbackOutcomes,
        }
      }
    } catch { /* stub fallback */ }
    return {
      verdict: 'Value realized (stub)',
      summary: 'Stub attribution pending LLM',
      outcomes: fallbackOutcomes,
    }
  }
}
