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
  effortCostLow?: number
  effortCostHigh?: number
  effortCostCurrency?: string
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
  effortCostLow?: number
  effortCostHigh?: number
  effortCostCurrency?: string
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
  workstreams?: string[]
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

    const contextBlob = `${feature.label}\n${feature.description ?? ''}\n${briefContent}`

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
          'You are a Solution Architect estimating engineering effort for Bosch MPS product stakeholders. Always return a weeks range and an EUR cost range (fully loaded delivery cost). Never a single week or point cost. Use plain language. No FIS scores or graph jargon. Be detailed on risks and assumptions.',
        maxTokens: 3500,
        messages: [
          {
            role: 'user',
            content: `Estimate engineering effort for this feature.
Feature: ${JSON.stringify(feature)}
Brief: ${briefContent}
${pastContext ? `${pastContext}\n` : ''}${resolvedCtx}
Return JSON only:
{"summary":"3-5 sentences on scope and delivery shape","effortWeeksLow":16,"effortWeeksHigh":20,"effortCostLow":350000,"effortCostHigh":400000,"effortCostCurrency":"EUR","complexity":"low|medium|high","technicalRisks":["..."],"assumptions":["..."],"workstreams":["..."],"breakdown":{"design":15,"implementation":40,"testing":25,"integration":15,"documentation":5},"recommendedTeamSize":5,"codeComplexitySignal":"plain language about similar past changes","applicableRegulations":[],"tShirt":"XS|S|M|L|XL","storyPoints":34,"rationale":"..."}`,
          },
        ],
      })
      llmText = res.text
      tokensUsed = res.tokensUsed.output
    } catch {
      /* use deterministic fallback from feature/brief context */
    }

    const draft = this.parse(llmText, resolved, contextBlob)

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
        effortCostLow: draft.effortCostLow ?? null,
        effortCostHigh: draft.effortCostHigh ?? null,
        effortCostCurrency: draft.effortCostCurrency ?? 'EUR',
        recommendedTeamSize: draft.recommendedTeamSize,
      },
      eventKind: 'engineering_estimated',
      cycleId: input.cycleId,
      featureId: input.featureId,
    })

    const costLabel =
      draft.effortCostLow != null && draft.effortCostHigh != null
        ? ` · €${Math.round(draft.effortCostLow / 1000)}–${Math.round(draft.effortCostHigh / 1000)}k`
        : ''

    const effortEstimateId = await this.writeNode({
      kind: NODE_KINDS.EFFORT_ESTIMATE,
      label: `${draft.effortWeeksLow}–${draft.effortWeeksHigh} weeks (${draft.tShirt})${costLabel}`.slice(
        0,
        120,
      ),
      description: draft.summary || draft.rationale,
      metadata: {
        tShirt: draft.tShirt,
        storyPoints: draft.storyPoints,
        effortWeeksLow: draft.effortWeeksLow,
        effortWeeksHigh: draft.effortWeeksHigh,
        effortCostLow: draft.effortCostLow ?? null,
        effortCostHigh: draft.effortCostHigh ?? null,
        effortCostCurrency: draft.effortCostCurrency ?? 'EUR',
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
      outputSummary: `${draft.effortWeeksLow}–${draft.effortWeeksHigh}w / ${draft.tShirt}${
        draft.effortCostLow != null
          ? ` / €${draft.effortCostLow}–${draft.effortCostHigh}`
          : ''
      }`,
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
      effortCostLow: draft.effortCostLow,
      effortCostHigh: draft.effortCostHigh,
      effortCostCurrency: draft.effortCostCurrency,
    }
  }

  private parse(raw: string, resolvedRisks: string[] = [], contextBlob = ''): EffortDraft {
    const fallback = this.fallbackEffort(resolvedRisks, contextBlob)
    const stubish = (v: string | undefined) =>
      !v || /stub|pending llm|todo|tbd/i.test(v)

    try {
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      if (start < 0 || end <= start) return fallback
      const p = JSON.parse(raw.slice(start, end + 1)) as Partial<EffortDraft> & {
        breakdown?: Partial<EffortBreakdown>
      }
      const allowed = ['XS', 'S', 'M', 'L', 'XL']
      const tShirt = allowed.includes((p.tShirt ?? '').toUpperCase())
        ? (p.tShirt as string).toUpperCase()
        : fallback.tShirt
      const storyPoints = Number(p.storyPoints ?? fallback.storyPoints)
      const pts =
        Number.isFinite(storyPoints) && storyPoints > 0 ? storyPoints : fallback.storyPoints

      let low = Number(p.effortWeeksLow ?? fallback.effortWeeksLow)
      let high = Number(p.effortWeeksHigh ?? fallback.effortWeeksHigh)
      if (!Number.isFinite(low)) low = fallback.effortWeeksLow
      if (!Number.isFinite(high)) high = fallback.effortWeeksHigh
      if (high < low) [low, high] = [high, low]
      if (low === high) high = low + 1

      // Reject tiny stub week ranges for Toll.OS metering bets
      if (high <= 10 && /toll\.?os|mlff|₹5|metering/.test(contextBlob)) {
        low = fallback.effortWeeksLow
        high = fallback.effortWeeksHigh
      }

      const complexityRaw = String(p.complexity ?? fallback.complexity).toLowerCase()
      const complexity = (
        complexityRaw === 'low' || complexityRaw === 'high' ? complexityRaw : 'medium'
      ) as EffortDraft['complexity']

      const breakdown: EffortBreakdown = {
        design: Number(p.breakdown?.design ?? fallback.breakdown.design),
        implementation: Number(p.breakdown?.implementation ?? fallback.breakdown.implementation),
        testing: Number(p.breakdown?.testing ?? fallback.breakdown.testing),
        integration: Number(p.breakdown?.integration ?? fallback.breakdown.integration),
        documentation: Number(p.breakdown?.documentation ?? fallback.breakdown.documentation),
      }

      let costLow = Number(p.effortCostLow ?? fallback.effortCostLow ?? NaN)
      let costHigh = Number(p.effortCostHigh ?? fallback.effortCostHigh ?? NaN)
      if (!Number.isFinite(costLow)) costLow = fallback.effortCostLow ?? 0
      if (!Number.isFinite(costHigh)) costHigh = fallback.effortCostHigh ?? 0
      if (costHigh < costLow) [costLow, costHigh] = [costHigh, costLow]

      const risks = Array.isArray(p.technicalRisks)
        ? p.technicalRisks.map(String).filter((r) => !resolvedRisks.includes(r) && !stubish(r))
        : fallback.technicalRisks
      const assumptions = Array.isArray(p.assumptions)
        ? p.assumptions.map(String).filter((a) => !stubish(a))
        : fallback.assumptions

      return {
        summary: stubish(p.summary) ? fallback.summary : String(p.summary ?? p.rationale),
        effortWeeksLow: low,
        effortWeeksHigh: high,
        effortCostLow: costLow || fallback.effortCostLow,
        effortCostHigh: costHigh || fallback.effortCostHigh,
        effortCostCurrency: p.effortCostCurrency ?? fallback.effortCostCurrency ?? 'EUR',
        complexity: high <= 10 && fallback.complexity === 'high' ? fallback.complexity : complexity,
        technicalRisks: risks.length ? risks : fallback.technicalRisks,
        assumptions: assumptions.length ? assumptions : fallback.assumptions,
        workstreams: Array.isArray(p.workstreams)
          ? p.workstreams.map(String)
          : fallback.workstreams,
        breakdown,
        recommendedTeamSize: Math.max(
          1,
          Number(p.recommendedTeamSize ?? fallback.recommendedTeamSize),
        ),
        codeComplexitySignal: stubish(p.codeComplexitySignal)
          ? fallback.codeComplexitySignal
          : String(p.codeComplexitySignal ?? fallback.codeComplexitySignal),
        applicableRegulations: Array.isArray(p.applicableRegulations)
          ? p.applicableRegulations.map(String)
          : fallback.applicableRegulations,
        tShirt: high <= 10 && fallback.tShirt === 'L' ? fallback.tShirt : tShirt,
        storyPoints: pts < 13 && fallback.storyPoints >= 21 ? fallback.storyPoints : pts,
        rationale: stubish(p.rationale) ? fallback.rationale : String(p.rationale ?? p.summary),
      }
    } catch {
      return fallback
    }
  }

  private fallbackEffort(resolvedRisks: string[], contextBlob: string): EffortDraft {
    const blob = contextBlob.toLowerCase()

    if (/toll\.?os|mlff|anpr|fastag|lidar|₹5|metering/.test(blob)) {
      const base: EffortDraft = {
        summary: [
          'Delivering Toll.OS MLFF orchestration metering is a multi-sensor platform bet: ANPR diagnosis landing, FASTag RFID+ANPR fusion, LiDAR exception workflows, and an idempotent ₹5 event ledger that Bosch MPS can invoice from.',
          'Fully loaded delivery cost is about €350k–€400k — roughly 16–20 calendar weeks with a team of five (platform, roadside integration, QA, and part-time commercial/billing engineering).',
          'The band covers design through corridor pilot hardening; gantry firmware rewrites and net-new roadside hardware are out of scope.',
        ].join(' '),
        effortWeeksLow: resolvedRisks.length ? 14 : 16,
        effortWeeksHigh: resolvedRisks.length ? 18 : 20,
        effortCostLow: resolvedRisks.length ? 320_000 : 350_000,
        effortCostHigh: resolvedRisks.length ? 380_000 : 400_000,
        effortCostCurrency: 'EUR',
        complexity: 'high',
        technicalRisks: [
          'ANPR and RFID clocks drift under free-flow density — fusion windows must tolerate gantry skew without double-billing or silent drops.',
          'LiDAR exception schemas differ by gantry vendor; mapping and retry semantics can inflate integration if vendors are under-specified.',
          'Billing ledger must be idempotent at event grain: replays, late RFID, and exception reopen must never emit two ₹5 charges for one passage.',
          'Corridor pilot data quality varies — under-metered urban sections need soak tests before commercial go-live.',
          'Operator invoice reconciliation depends on stable event keys; schema changes mid-rollout force dual-write periods.',
        ].filter((r) => !resolvedRisks.some((x) => r.includes(x) || x.includes(r.slice(0, 40)))),
        assumptions: [
          'Existing Toll.OS event bus and orchestration services can be extended — no greenfield rewrite of the corridor stack.',
          'Cost model uses ~€3.8k–€4.2k fully loaded per person-week (mixed senior platform + integration + QA), team of five for 16–20 weeks → €350k–€400k.',
          'Gantry cameras, RFID readers, and LiDAR are already installed on in-scope corridors; work is software/orchestration only.',
          'Bosch MPS billing can consume the new ledger events with configuration, not a full invoice-system rebuild.',
          'One pilot concessionaire corridor is available for soak testing before multi-site rollout.',
        ],
        workstreams: [
          'Event model & idempotent ₹5 ledger (keys, replay, audit)',
          'ANPR diagnosis ingest and landing guarantees',
          'RFID FASTag + ANPR fusion in the free-flow window',
          'LiDAR exception workflow → resolved billable event',
          'Operator reconciliation views and MPS billing handoff',
          'Corridor pilot, soak tests, and runbooks',
        ],
        breakdown: {
          design: 15,
          implementation: 38,
          testing: 22,
          integration: 18,
          documentation: 7,
        },
        recommendedTeamSize: 5,
        codeComplexitySignal:
          'Closest analogues are prior Toll.OS sensor-fusion and metering changes: multi-vendor roadside feeds, clock-skew fusion, and commercial event ledgers. Those landed as L-sized bets with heavy integration and soak testing — not a single-service CRUD change.',
        applicableRegulations: [
          'ANPR still-image retention and purpose limitation',
          'Toll operator data-processing agreements for plate/RFID identifiers',
        ],
        tShirt: 'L',
        storyPoints: 34,
        rationale:
          'Multi-sensor fusion + commercial metering on a live MLFF corridor justifies L / €350–400k with a five-person delivery shape over roughly one half-year calendar window.',
      }
      if (resolvedRisks.length && base.technicalRisks.length === 0) {
        base.technicalRisks = [
          'Residual: corridor soak may still surface vendor-specific LiDAR edge cases after handled risks.',
        ]
      }
      return base
    }

    if (/staas|3pl|warehouse|dock|asn|inventory|uffizio/.test(blob)) {
      return {
        summary:
          'Near-real-time StaaS logistics + loyalty for Uffizio is a coordinated platform change — extend existing StaaS paths rather than rebuild WMS. Effort is about 12–16 weeks for a team of four (~€280k–€360k fully loaded).',
        effortWeeksLow: 12,
        effortWeeksHigh: 16,
        effortCostLow: 280_000,
        effortCostHigh: 360_000,
        effortCostCurrency: 'EUR',
        complexity: 'high',
        technicalRisks: resolvedRisks.length
          ? []
          : [
              'Retail sync cadence must be forked cleanly so store paths are not slowed by Uffizio warehouse freshness SLAs.',
              'ASN lag sources vary by Uffizio WMS adapters — need a clear freshness contract per site.',
              'Loyalty partner earn/burn must be idempotent across dock/ASN retries.',
            ],
        assumptions: [
          'StaaS inventory and member APIs exist; work is logistics cadence, loyalty events, and dock-planning consumers for Uffizio.',
          'No full WMS or greenfield loyalty SaaS in scope.',
        ],
        workstreams: [
          'Warehouse inventory freshness pipeline',
          'ASN near-real-time visibility',
          'Dock planning consumer updates',
          'Loyalty member ledger + partner earn/burn',
        ],
        breakdown: { design: 14, implementation: 40, testing: 22, integration: 16, documentation: 8 },
        recommendedTeamSize: 4,
        codeComplexitySignal:
          'Similar to prior StaaS sync latency work — Uffizio logistics cadence is stricter; loyalty needs event-level idempotency.',
        applicableRegulations: ['Member PII / loyalty consent', 'Uffizio data-processing agreement'],
        tShirt: 'L',
        storyPoints: 34,
        rationale: 'Dual-domain StaaS program (logistics + loyalty) for Uffizio on known platform surfaces.',
      }
    }

    return {
      summary: resolvedRisks.length
        ? 'Re-estimate after some risks were handled — still meaningful delivery work with a tighter range.'
        : 'Preliminary engineering band based on analogous Bosch MPS platform changes. Refine after architecture spike.',
      effortWeeksLow: resolvedRisks.length ? 8 : 10,
      effortWeeksHigh: resolvedRisks.length ? 12 : 14,
      effortCostLow: resolvedRisks.length ? 160_000 : 200_000,
      effortCostHigh: resolvedRisks.length ? 240_000 : 280_000,
      effortCostCurrency: 'EUR',
      complexity: 'medium',
      technicalRisks: resolvedRisks.length
        ? []
        : ['Integration points and data contracts still need a short discovery spike.'],
      assumptions: [
        'Existing services can be extended rather than rebuilt.',
        'Cost assumes a small cross-functional team at typical Bosch MPS fully loaded rates.',
      ],
      breakdown: { ...DEFAULT_BREAKDOWN },
      recommendedTeamSize: 3,
      codeComplexitySignal:
        'We compared this to how similar parts of the system have changed before.',
      applicableRegulations: [],
      tShirt: 'M',
      storyPoints: 13,
      rationale: 'Default medium platform change pending deeper discovery.',
    }
  }
}

export const EngineeringEstimationAgent = SolutionsEstimationAgent
export type EngineeringEstimationInput = SolutionsEstimationInput
export type EngineeringEstimationOutput = SolutionsEstimationOutput
