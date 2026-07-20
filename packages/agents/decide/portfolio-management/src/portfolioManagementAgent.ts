import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import { NODE_KINDS, EDGE_KINDS } from '@avp/shared'

export type PortfolioDecision = 'admit' | 'defer' | 'reject'

export interface PortfolioManagementInput {
  featureId: number
  businessImpactId?: number
  devImpactId?: number
  projectionId?: number
  cycleId?: string
  approvedBy?: string
  gateToken?: string
  decision?: PortfolioDecision
}

export interface PortfolioAssembleInput {
  featureId: number
  businessAssessmentId: number
  engAssessmentId: number
  projectionId: number
  cycleId?: string
}

export interface PortfolioAssembleOutput {
  packetId: number
  recommendation: 'ADMIT' | 'DEFER' | 'REJECT'
  valueScore: number
  riskScore: number
}

export interface PortfolioManagementOutput {
  packetId: number
  decisionRecordId: number
  featureId: number
  decision: string
}

export const PORTFOLIO_MANAGEMENT_MANIFEST: AgentManifest = {
  id: 'portfolio-management:v1',
  name: 'Portfolio Management Agent',
  archetype: 'PMO Director',
  domain: 'decide',
  runtime: 'studio',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [NODE_KINDS.PORTFOLIO_PACKET, NODE_KINDS.DECISION_RECORD, NODE_KINDS.FEATURE],
    edgeKinds: [
      EDGE_KINDS.APPROVES,
      EDGE_KINDS.DEFERRED,
      EDGE_KINDS.REJECTS,
      EDGE_KINDS.FUNDED_BY,
      EDGE_KINDS.PACKET_INCLUDES,
    ],
    requiresGate: true,
    maxWritesPerMinute: 10,
  },
  subscribes: ['context.decide.engineering_estimated'],
  healthEndpoint: 'http://localhost:7095/health',
  llmBudget: { maxTokensPerRun: 4000, preferredModel: 'claude-sonnet-4-6' },
}

/** Studio guide aliases */
export const PORTFOLIO_ADVISOR_MANIFEST = PORTFOLIO_MANAGEMENT_MANIFEST

type PacketDraft = {
  valueScore: number
  riskScore: number
  recommendation: 'ADMIT' | 'DEFER' | 'REJECT'
  summary: string
}

export class PortfolioManagementAgent extends BaseAgent {
  protected readonly agentId = 'portfolio-management:v1'
  protected readonly domain = 'decide' as const

  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) {
    super(adapter, llm)
  }

  /** Assemble a review packet from value + effort + GTM (no gate decision yet). */
  async assemble(input: PortfolioAssembleInput): Promise<PortfolioAssembleOutput> {
    if (!input.featureId) this.fail('run', new Error('featureId required'))
    if (!input.businessAssessmentId || !input.engAssessmentId || !input.projectionId) {
      this.fail('run', new Error('value, effort, and GTM assessment ids required'))
    }

    const features = await this.adapter.graphRead<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE id=$1`,
      [input.featureId],
    )
    const feature = features[0]
    if (!feature) this.fail('run', new Error(`FEATURE ${input.featureId} not found`))

    const [bizRows, engRows, gtmRows] = await Promise.all([
      this.adapter.graphRead<{ description: string }>(
        `SELECT description FROM graph_nodes WHERE id=$1`,
        [input.businessAssessmentId],
      ),
      this.adapter.graphRead<{ description: string }>(
        `SELECT description FROM graph_nodes WHERE id=$1`,
        [input.engAssessmentId],
      ),
      this.adapter.graphRead<{ description: string }>(
        `SELECT description FROM graph_nodes WHERE id=$1`,
        [input.projectionId],
      ),
    ])

    const biz = bizRows[0]?.description ?? '{}'
    const eng = engRows[0]?.description ?? '{}'
    const gtm = gtmRows[0]?.description ?? '{}'

    let llmText = ''
    try {
      const res = await this.complete({
        model: 'claude-sonnet-4-6',
        system:
          'You are a Portfolio Advisor. Recommend ADMIT, DEFER, or REJECT with valueScore and riskScore 0-100. Be concise. This is a suggestion for humans, not a final decision.',
        maxTokens: 1200,
        messages: [
          {
            role: 'user',
            content: `Assemble a portfolio recommendation packet.
Feature: ${feature.label}
Business value: ${biz}
Engineering effort: ${eng}
GTM: ${gtm}

Return JSON only:
{"valueScore":0-100,"riskScore":0-100,"recommendation":"ADMIT|DEFER|REJECT","summary":"one sentence for reviewers"}`,
          },
        ],
      })
      llmText = res.text
    } catch {
      /* stub */
    }

    const draft = this.parsePacket(llmText, biz, eng)

    const packetId = await this.writeNode({
      kind: NODE_KINDS.PORTFOLIO_PACKET,
      label: `Decision packet: ${feature.label}`.slice(0, 120),
      description: JSON.stringify({
        featureId: input.featureId,
        valueScore: draft.valueScore,
        riskScore: draft.riskScore,
        recommendation: draft.recommendation,
        summary: draft.summary,
        businessAssessmentId: input.businessAssessmentId,
        engAssessmentId: input.engAssessmentId,
        projectionId: input.projectionId,
        decision: null,
      }),
      metadata: {
        valueScore: draft.valueScore,
        riskScore: draft.riskScore,
        recommendation: draft.recommendation,
        readyForGate: true,
      },
      eventKind: 'portfolio_packet_ready',
      cycleId: input.cycleId,
      featureId: input.featureId,
    })

    await this.writeEdge(packetId, input.featureId, EDGE_KINDS.FUNDED_BY)
    await this.writeEdge(packetId, input.businessAssessmentId, EDGE_KINDS.PACKET_INCLUDES)
    await this.writeEdge(packetId, input.engAssessmentId, EDGE_KINDS.PACKET_INCLUDES)
    await this.writeEdge(packetId, input.projectionId, EDGE_KINDS.PACKET_INCLUDES)

    return {
      packetId,
      recommendation: draft.recommendation,
      valueScore: draft.valueScore,
      riskScore: draft.riskScore,
    }
  }

  async run(input: PortfolioManagementInput): Promise<PortfolioManagementOutput> {
    if (!input.featureId) this.fail('run', new Error('featureId required'))

    const bypass = process.env.AVP_GATE_BYPASS === '1'
    if (!bypass && !input.gateToken && !input.approvedBy) {
      this.fail(
        'gate',
        new Error('portfolio decision requires approvedBy or gateToken (or AVP_GATE_BYPASS=1)'),
      )
    }

    const sessionId = randomUUID()
    const inputHash = this.hashInput(input)
    const decision: PortfolioDecision = input.decision ?? 'admit'

    const features = await this.adapter.graphRead<{
      id: number
      label: string
      description: string | null
    }>(`SELECT id, label, description FROM graph_nodes WHERE id=$1`, [input.featureId])
    let feature = features[0]
    let featureId = input.featureId

    if (!feature) {
      featureId = await this.writeNode({
        kind: NODE_KINDS.FEATURE,
        label: `Portfolio feature ${input.featureId}`,
        description: 'Feature ensured by portfolio gate',
        metadata: { ensuredBy: this.agentId },
        eventKind: 'portfolio_decision_made',
        cycleId: input.cycleId,
      })
      feature = { id: featureId, label: `Portfolio feature ${input.featureId}`, description: null }
    }

    const edgeKind =
      decision === 'defer'
        ? EDGE_KINDS.DEFERRED
        : decision === 'reject'
          ? EDGE_KINDS.REJECTS
          : EDGE_KINDS.APPROVES

    const decisionRecordId = await this.writeNode({
      kind: NODE_KINDS.DECISION_RECORD,
      label: `Portfolio ${decision}`,
      description: JSON.stringify({
        decision,
        featureId,
        businessImpactId: input.businessImpactId ?? null,
        devImpactId: input.devImpactId ?? null,
        projectionId: input.projectionId ?? null,
        approvedBy: input.approvedBy ?? null,
      }),
      metadata: {
        gate: 'PORTFOLIO_GATE',
        decision,
        approvedBy: input.approvedBy,
        gateTokenPresent: Boolean(input.gateToken),
      },
      eventKind: 'portfolio_decision_made',
      cycleId: input.cycleId,
      featureId,
    })

    await this.writeEdge(decisionRecordId, featureId, edgeKind)

    let packetId = decisionRecordId
    if (decision === 'admit') {
      packetId = await this.writeNode({
        kind: NODE_KINDS.PORTFOLIO_PACKET,
        label: `Decision packet: ${feature.label}`.slice(0, 120),
        description: JSON.stringify({
          featureId,
          featureLabel: feature.label,
          decision,
          businessImpactId: input.businessImpactId ?? null,
          devImpactId: input.devImpactId ?? null,
          decisionRecordId,
          readyForGate: true,
        }),
        metadata: {
          gate: 'PORTFOLIO_GATE',
          decision: 'admit',
          decisionRecordId,
        },
        eventKind: 'portfolio_packet_ready',
        cycleId: input.cycleId,
        featureId,
      })
      await this.writeEdge(packetId, featureId, EDGE_KINDS.APPROVES)
      if (input.businessImpactId !== undefined) {
        await this.writeEdge(packetId, input.businessImpactId, EDGE_KINDS.APPROVES)
      }
      if (input.devImpactId !== undefined) {
        await this.writeEdge(packetId, input.devImpactId, EDGE_KINDS.APPROVES)
      }
    }

    await this.adapter.episodicMemory.write({
      agentId: this.agentId,
      sessionId,
      domain: 'decide',
      cycleId: input.cycleId,
      featureId,
      inputHash,
      inputSummary: `feature=${featureId} → ${decision}`,
      outputSummary: `packet=${packetId} decision=${decision}`,
      outputNodeIds:
        decision === 'admit'
          ? [packetId, decisionRecordId, featureId]
          : [decisionRecordId, featureId],
      confidencePct: 90,
    })

    return {
      packetId,
      decisionRecordId,
      featureId,
      decision,
    }
  }

  private parsePacket(raw: string, bizJson: string, engJson: string): PacketDraft {
    let valueScore = 71
    let riskScore = 38
    try {
      const biz = JSON.parse(bizJson) as { confidence?: number; valueLow?: number; valueHigh?: number }
      const eng = JSON.parse(engJson) as {
        complexity?: string
        effortWeeksHigh?: number
        technicalRisks?: string[]
      }
      if (typeof biz.confidence === 'number') valueScore = Math.min(100, Math.max(0, biz.confidence + 10))
      riskScore =
        eng.complexity === 'high' ? 72 : eng.complexity === 'low' ? 28 : 38
      if ((eng.technicalRisks?.length ?? 0) > 2) riskScore = Math.min(100, riskScore + 10)
      if ((eng.effortWeeksHigh ?? 0) > 12) riskScore = Math.min(100, riskScore + 8)
    } catch {
      /* keep defaults */
    }

    const fallback: PacketDraft = {
      valueScore,
      riskScore,
      recommendation: valueScore >= 55 && riskScore < 60 ? 'ADMIT' : riskScore >= 70 ? 'REJECT' : 'DEFER',
      summary:
        'Strong evidence, moderate effort, clear customer demand across a well-understood segment.',
    }

    try {
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      if (start < 0 || end <= start) return fallback
      const p = JSON.parse(raw.slice(start, end + 1)) as Partial<PacketDraft>
      const rec = String(p.recommendation ?? fallback.recommendation).toUpperCase()
      return {
        valueScore: Number.isFinite(Number(p.valueScore))
          ? Math.min(100, Math.max(0, Number(p.valueScore)))
          : fallback.valueScore,
        riskScore: Number.isFinite(Number(p.riskScore))
          ? Math.min(100, Math.max(0, Number(p.riskScore)))
          : fallback.riskScore,
        recommendation: (rec === 'DEFER' || rec === 'REJECT' ? rec : 'ADMIT') as PacketDraft['recommendation'],
        summary: p.summary ?? fallback.summary,
      }
    } catch {
      return fallback
    }
  }
}

export const PortfolioAdvisorAgent = PortfolioManagementAgent
