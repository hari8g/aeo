import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import { NODE_KINDS, EDGE_KINDS } from '@avp/shared'

export interface SolutionsEstimationInput {
  featureId: number
  briefId?: number
  cycleId?: string
  /** Risks the human marked as handled — ground the re-estimate on these. */
  resolvedRisks?: string[]
}

export interface SolutionsEstimationOutput {
  devImpactId: number
  effortEstimateId: number
  tShirt: string
  storyPoints: number
  effortWeeksLow: number
  effortWeeksHigh: number
}

type EffortBreakdown = {
  design: number
  implementation: number
  testing: number
  integration: number
  documentation: number
}

type EffortDraft = {
  summary: string
  effortWeeksLow: number
  effortWeeksHigh: number
  complexity: 'low' | 'medium' | 'high'
  technicalRisks: string[]
  assumptions: string[]
  breakdown: EffortBreakdown
  recommendedTeamSize: number
  codeComplexitySignal: string
  applicableRegulations: string[]
  tShirt: string
  storyPoints: number
  rationale: string
}

const DEFAULT_BREAKDOWN: EffortBreakdown = {
  design: 15,
  implementation: 45,
  testing: 25,
  integration: 10,
  documentation: 5,
}

export const SOLUTIONS_ESTIMATION_MANIFEST: AgentManifest = {
  id: 'solutions-estimation:v1',
  name: 'Solutions Estimation Agent',
  archetype: 'Solution Architect',
  domain: 'decide',
  runtime: 'engineering',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [NODE_KINDS.DEV_IMPACT, NODE_KINDS.EFFORT_ESTIMATE],
    edgeKinds: [EDGE_KINDS.ESTIMATES, EDGE_KINDS.BOUNDED_BY],
    requiresGate: false,
    maxWritesPerMinute: 20,
  },
  subscribes: ['context.decide.brief_written'],
  healthEndpoint: 'http://localhost:7094/health',
  llmBudget: { maxTokensPerRun: 6000, preferredModel: 'claude-sonnet-4-6' },
}

/** Studio guide aliases (Engineering Effort / Estimation Agent) */
export const ENGINEERING_ESTIMATION_MANIFEST = SOLUTIONS_ESTIMATION_MANIFEST

export class SolutionsEstimationAgent extends BaseAgent {
  protected readonly agentId = 'solutions-estimation:v1'
  protected readonly domain = 'decide' as const

  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) {
    super(adapter, llm)
  }

  async run(input: SolutionsEstimationInput): Promise<SolutionsEstimationOutput> {
    if (!input.featureId) this.fail('run', new Error('featureId required'))

    const sessionId = randomUUID()
    const inputHash = this.hashInput(input)
    let tokensUsed = 0

    const features = await this.adapter.graphRead<{
      id: number
      label: string
      description: string | null
    }>(`SELECT id, label, description FROM graph_nodes WHERE id=$1`, [input.featureId])
    const feature = features[0]
    if (!feature) this.fail('run', new Error(`FEATURE node ${input.featureId} not found`))

    let briefContent = '{}'
    if (input.briefId !== undefined) {
      const brief = await this.adapter.graphRead<{ description: string }>(
        `SELECT description FROM graph_nodes WHERE id=$1`,
        [input.briefId],
      )
      briefContent = brief[0]?.description ?? '{}'
    }

    const past = await this.adapter.episodicMemory.readSimilar(this.agentId, inputHash, 3)
    const pastSummaries = past
      .map(
        (p) =>
          (p as { outputSummary?: string; output_summary?: string }).outputSummary ??
          (p as { output_summary?: string }).output_summary,
      )
      .filter(Boolean)
    const pastContext =
      pastSummaries.length > 0 ? `Previous similar estimates: ${pastSummaries.join('; ')}` : ''

    const resolved = input.resolvedRisks?.filter(Boolean) ?? []
    const resolvedCtx = resolved.length
      ? `\nRisks already handled by the team (reduce effort where these applied):\n${resolved.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n`
      : ''

    let llmText = ''
    try {
      const res = await this.complete({
        model: 'claude-sonnet-4-6',
        system:
          'You are a Solution Architect estimating engineering effort for product stakeholders. Always return a weeks range (low–high), never a single week count. Use plain language. No FIS scores or graph jargon.',
        maxTokens: 2500,
        messages: [
          {
            role: 'user',
            content: `Estimate engineering effort for this feature.
Feature: ${JSON.stringify(feature)}
Brief: ${briefContent}
${pastContext ? `${pastContext}\n` : ''}${resolvedCtx}
Return JSON only:
{"summary":"1-2 sentences","effortWeeksLow":6,"effortWeeksHigh":9,"complexity":"low|medium|high","technicalRisks":["..."],"assumptions":["..."],"breakdown":{"design":15,"implementation":45,"testing":25,"integration":10,"documentation":5},"recommendedTeamSize":2,"codeComplexitySignal":"plain language about similar past changes","applicableRegulations":[],"tShirt":"XS|S|M|L|XL","storyPoints":8,"rationale":"..."}`,
          },
        ],
      })
      llmText = res.text
      tokensUsed = res.tokensUsed.output
    } catch {
      /* stub fallback */
    }

    const draft = this.parse(llmText, resolved)

    const devImpactId = await this.writeNode({
      kind: NODE_KINDS.DEV_IMPACT,
      label: `Engineering estimate: ${feature.label}`.slice(0, 120),
      description: JSON.stringify({
        ...draft,
        featureId: input.featureId,
        briefId: input.briefId ?? null,
        addressedRiskIndices: [],
      }),
      metadata: {
        tShirt: draft.tShirt,
        storyPoints: draft.storyPoints,
        complexity: draft.complexity,
        effortWeeksLow: draft.effortWeeksLow,
        effortWeeksHigh: draft.effortWeeksHigh,
        recommendedTeamSize: draft.recommendedTeamSize,
      },
      eventKind: 'engineering_estimated',
      cycleId: input.cycleId,
      featureId: input.featureId,
    })

    const effortEstimateId = await this.writeNode({
      kind: NODE_KINDS.EFFORT_ESTIMATE,
      label: `${draft.effortWeeksLow}–${draft.effortWeeksHigh} weeks (${draft.tShirt})`.slice(0, 120),
      description: draft.summary || draft.rationale,
      metadata: {
        tShirt: draft.tShirt,
        storyPoints: draft.storyPoints,
        effortWeeksLow: draft.effortWeeksLow,
        effortWeeksHigh: draft.effortWeeksHigh,
      },
      eventKind: 'engineering_estimated',
      cycleId: input.cycleId,
      featureId: input.featureId,
    })

    await this.writeEdge(devImpactId, input.featureId, EDGE_KINDS.ESTIMATES)
    await this.writeEdge(devImpactId, effortEstimateId, EDGE_KINDS.BOUNDED_BY)

    await this.adapter.episodicMemory.write({
      agentId: this.agentId,
      sessionId,
      domain: 'decide',
      cycleId: input.cycleId,
      featureId: input.featureId,
      inputHash,
      inputSummary: `feature=${input.featureId}`,
      outputSummary: `${draft.effortWeeksLow}–${draft.effortWeeksHigh}w / ${draft.tShirt}`,
      outputNodeIds: [devImpactId, effortEstimateId],
      confidencePct: 68,
      llmTokensUsed: tokensUsed,
    })

    return {
      devImpactId,
      effortEstimateId,
      tShirt: draft.tShirt,
      storyPoints: draft.storyPoints,
      effortWeeksLow: draft.effortWeeksLow,
      effortWeeksHigh: draft.effortWeeksHigh,
    }
  }

  private parse(raw: string, resolvedRisks: string[] = []): EffortDraft {
    const allowed = ['XS', 'S', 'M', 'L', 'XL']
    const weeksFromPoints = (pts: number) => {
      const mid = Math.max(2, Math.round(pts * 0.75))
      return { low: Math.max(1, mid - 1), high: mid + 2 }
    }
    const fallbackWeeks = resolvedRisks.length
      ? { low: 4, high: 7 }
      : { low: 6, high: 9 }

    const fallback: EffortDraft = {
      summary: resolvedRisks.length
        ? 'Re-estimate after some risks were handled — still moderate work with a tighter range.'
        : 'Stub engineering estimate pending LLM',
      effortWeeksLow: fallbackWeeks.low,
      effortWeeksHigh: fallbackWeeks.high,
      complexity: 'medium',
      technicalRisks: resolvedRisks.length
        ? []
        : ['Stub risk: integration points not yet mapped'],
      assumptions: ['Assumes existing services can be extended rather than rebuilt'],
      breakdown: { ...DEFAULT_BREAKDOWN },
      recommendedTeamSize: 2,
      codeComplexitySignal:
        'We compared this to how similar parts of the system have changed before.',
      applicableRegulations: [],
      tShirt: 'M',
      storyPoints: 8,
      rationale: 'Stub estimate pending LLM',
    }

    try {
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      if (start < 0 || end <= start) return fallback
      const p = JSON.parse(raw.slice(start, end + 1)) as Partial<EffortDraft> & {
        breakdown?: Partial<EffortBreakdown>
      }
      const tShirt = allowed.includes((p.tShirt ?? '').toUpperCase())
        ? (p.tShirt as string).toUpperCase()
        : 'M'
      const storyPoints = Number(p.storyPoints ?? 8)
      const pts = Number.isFinite(storyPoints) && storyPoints > 0 ? storyPoints : 8
      const derived = weeksFromPoints(pts)

      let low = Number(p.effortWeeksLow ?? derived.low)
      let high = Number(p.effortWeeksHigh ?? derived.high)
      if (!Number.isFinite(low)) low = derived.low
      if (!Number.isFinite(high)) high = derived.high
      if (high < low) [low, high] = [high, low]
      if (low === high) high = low + 1

      const complexityRaw = String(p.complexity ?? 'medium').toLowerCase()
      const complexity = (
        complexityRaw === 'low' || complexityRaw === 'high' ? complexityRaw : 'medium'
      ) as EffortDraft['complexity']

      const breakdown: EffortBreakdown = {
        design: Number(p.breakdown?.design ?? DEFAULT_BREAKDOWN.design),
        implementation: Number(p.breakdown?.implementation ?? DEFAULT_BREAKDOWN.implementation),
        testing: Number(p.breakdown?.testing ?? DEFAULT_BREAKDOWN.testing),
        integration: Number(p.breakdown?.integration ?? DEFAULT_BREAKDOWN.integration),
        documentation: Number(p.breakdown?.documentation ?? DEFAULT_BREAKDOWN.documentation),
      }

      return {
        summary: p.summary ?? p.rationale ?? fallback.summary,
        effortWeeksLow: low,
        effortWeeksHigh: high,
        complexity,
        technicalRisks: Array.isArray(p.technicalRisks)
          ? p.technicalRisks.map(String).filter((r) => !resolvedRisks.includes(r))
          : fallback.technicalRisks,
        assumptions: Array.isArray(p.assumptions) ? p.assumptions.map(String) : fallback.assumptions,
        breakdown,
        recommendedTeamSize: Math.max(1, Number(p.recommendedTeamSize ?? 2)),
        codeComplexitySignal: p.codeComplexitySignal ?? fallback.codeComplexitySignal,
        applicableRegulations: Array.isArray(p.applicableRegulations)
          ? p.applicableRegulations.map(String)
          : [],
        tShirt,
        storyPoints: pts,
        rationale: p.rationale ?? p.summary ?? fallback.rationale,
      }
    } catch {
      return fallback
    }
  }
}

export const EngineeringEstimationAgent = SolutionsEstimationAgent
export type EngineeringEstimationInput = SolutionsEstimationInput
export type EngineeringEstimationOutput = SolutionsEstimationOutput
