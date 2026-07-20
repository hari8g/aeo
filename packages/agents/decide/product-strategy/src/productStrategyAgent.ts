import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import { NODE_KINDS, EDGE_KINDS } from '@avp/shared'

export interface ProductStrategyInput {
  featureId: number
  featureLabel?: string
  /** Business value assessment this GTM plan builds on (required for Studio flow). */
  assessmentId?: number
  painPointIds?: number[]
  cycleId?: string
}

export interface ProductStrategyOutput {
  projectionId: number
  segmentIds: number[]
}

type SegmentDraft = {
  name: string
  size: string
  fit: string
  cac: string
  ltv: string
}

type GtmDraft = {
  positioning: string
  segments: SegmentDraft[]
  go_to_market: string
  competitive_differentiation: string
}

export const PRODUCT_STRATEGY_MANIFEST: AgentManifest = {
  id: 'product-strategy:v1',
  name: 'Product Strategy Agent',
  archetype: 'Product Strategist',
  domain: 'decide',
  runtime: 'studio',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [NODE_KINDS.GTM_PROJECTION, NODE_KINDS.SEGMENT],
    edgeKinds: [EDGE_KINDS.INFORMS, EDGE_KINDS.ADDRESSES, EDGE_KINDS.BETS_ON],
    requiresGate: false,
    maxWritesPerMinute: 20,
  },
  subscribes: ['context.decide.business_impact_assessed'],
  healthEndpoint: 'http://localhost:7093/health',
  llmBudget: { maxTokensPerRun: 4000, preferredModel: 'claude-sonnet-4-6' },
}

export class ProductStrategyAgent extends BaseAgent {
  protected readonly agentId = 'product-strategy:v1'
  protected readonly domain = 'decide' as const

  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) {
    super(adapter, llm)
  }

  async run(input: ProductStrategyInput): Promise<ProductStrategyOutput> {
    if (!input.featureId) this.fail('run', new Error('featureId required'))

    const sessionId = randomUUID()
    const inputHash = this.hashInput(input)
    let tokensUsed = 0

    const features = await this.adapter.graphRead<{ id: number; label: string; description: string | null }>(
      `SELECT id, label, description FROM graph_nodes WHERE id=$1`,
      [input.featureId],
    )
    const feature = features[0]
    if (!feature) this.fail('run', new Error(`FEATURE node ${input.featureId} not found`))

    let painPoints: Array<{ id: number; label: string }> = []
    if (input.painPointIds?.length) {
      painPoints = await this.adapter.graphRead(
        `SELECT id, label FROM graph_nodes WHERE id = ANY($1::int[])`,
        [input.painPointIds],
      )
    }

    let valueAssessment = '{}'
    if (input.assessmentId) {
      const rows = await this.adapter.graphRead<{ description: string }>(
        `SELECT description FROM graph_nodes WHERE id=$1 AND kind=$2`,
        [input.assessmentId, NODE_KINDS.BUSINESS_IMPACT],
      )
      valueAssessment = rows[0]?.description ?? '{}'
    }

    let llmText = ''
    try {
      const res = await this.complete({
        model: 'claude-sonnet-4-6',
        system:
          'You are a GTM strategist. Use plain language. Segment size/cac/ltv must be qualitative (small|medium|large or low|medium|high), never invent fake dollar figures.',
        maxTokens: 1500,
        messages: [{
          role: 'user',
          content: `Produce a go-to-market projection grounded in the business value assessment.
Feature: ${JSON.stringify({ ...feature, label: input.featureLabel ?? feature.label })}
Business value assessment: ${valueAssessment}
Pain points: ${JSON.stringify(painPoints)}

Return JSON only:
{"positioning":"one sentence","segments":[{"name":"segment name","size":"small|medium|large","fit":"low|medium|high","cac":"low|medium|high","ltv":"low|medium|high"}],"go_to_market":"brief GTM approach","competitive_differentiation":"how this differentiates"}`,
        }],
      })
      llmText = res.text
      tokensUsed = res.tokensUsed.output
    } catch {
      /* stub fallback */
    }

    const parsed = this.parse(llmText, input.featureLabel ?? feature.label)

    const projectionId = await this.writeNode({
      kind: NODE_KINDS.GTM_PROJECTION,
      label: `GTM: ${input.featureLabel ?? feature.label}`.slice(0, 120),
      description: JSON.stringify({
        ...parsed,
        featureId: input.featureId,
        assessmentId: input.assessmentId ?? null,
      }),
      metadata: {
        segmentCount: parsed.segments.length,
        featureId: input.featureId,
        assessmentId: input.assessmentId ?? null,
        topSegment: parsed.segments.find((s) => s.fit === 'high')?.name
          ?? parsed.segments[0]?.name
          ?? null,
      },
      eventKind: 'gtm_projected',
      cycleId: input.cycleId,
      featureId: input.featureId,
    })

    await this.writeEdge(projectionId, input.featureId, EDGE_KINDS.INFORMS)
    await this.writeEdge(projectionId, input.featureId, EDGE_KINDS.ADDRESSES)
    for (const ppId of input.painPointIds ?? []) {
      await this.writeEdge(projectionId, ppId, EDGE_KINDS.ADDRESSES)
    }

    const segmentIds: number[] = []
    for (const seg of parsed.segments) {
      const sid = await this.writeNode({
        kind: NODE_KINDS.SEGMENT,
        label: seg.name.slice(0, 120),
        description: JSON.stringify(seg),
        metadata: { fit: seg.fit, size: seg.size },
        eventKind: 'segment_identified',
        cycleId: input.cycleId,
        featureId: input.featureId,
      })
      segmentIds.push(sid)
      await this.writeEdge(projectionId, sid, EDGE_KINDS.BETS_ON)
    }

    await this.adapter.episodicMemory.write({
      agentId: this.agentId,
      sessionId,
      domain: 'decide',
      cycleId: input.cycleId,
      featureId: input.featureId,
      inputHash,
      inputSummary: `feature=${input.featureId}`,
      outputSummary: `${parsed.positioning}; ${segmentIds.length} segments`,
      outputNodeIds: [projectionId, ...segmentIds],
      confidencePct: 72,
      llmTokensUsed: tokensUsed,
    })

    return { projectionId, segmentIds }
  }

  private parse(raw: string, featureLabel: string): GtmDraft {
    const fallback: GtmDraft = {
      positioning: `Position ${featureLabel} for primary customer segment`,
      segments: [{
        name: 'Primary segment (stub)',
        size: 'medium',
        fit: 'high',
        cac: 'medium',
        ltv: 'unknown',
      }],
      go_to_market: 'Stub GTM approach pending LLM',
      competitive_differentiation: 'Stub differentiation pending LLM',
    }

    try {
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      if (start < 0 || end <= start) return fallback
      const p = JSON.parse(raw.slice(start, end + 1)) as Partial<GtmDraft> & {
        segments?: Array<Partial<SegmentDraft>>
      }
      const segments = (p.segments?.length ? p.segments : fallback.segments).map((s, i) => ({
        name: s.name ?? `Segment ${i + 1}`,
        size: s.size ?? 'medium',
        fit: s.fit ?? 'medium',
        cac: s.cac ?? 'medium',
        ltv: s.ltv ?? 'unknown',
      }))
      return {
        positioning: p.positioning ?? fallback.positioning,
        segments,
        go_to_market: p.go_to_market ?? fallback.go_to_market,
        competitive_differentiation: p.competitive_differentiation ?? fallback.competitive_differentiation,
      }
    } catch {
      return fallback
    }
  }
}

/** Studio guide aliases (GTM Strategy Agent) */
export const GTM_STRATEGY_MANIFEST = PRODUCT_STRATEGY_MANIFEST
export const GtmStrategyAgent = ProductStrategyAgent
export type GtmStrategyInput = ProductStrategyInput
export type GtmStrategyOutput = ProductStrategyOutput
