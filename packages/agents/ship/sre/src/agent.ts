import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import { NODE_KINDS, EDGE_KINDS } from '@avp/shared'

export interface SreInput {
  service: string
  sliWindow: string
  target?: number
  fixtureMetrics?: { sli: number }
  cycleId?: string
  deploymentId?: number
  kpiLabel?: string
}

export interface SreOutput {
  observationId: number
  breachId?: number
  healthy: boolean
}

export const SRE_MANIFEST: AgentManifest = {
  id: 'sre:v1',
  name: 'SRE Agent',
  archetype: 'Site Reliability Engineer',
  domain: 'ship',
  runtime: 'observability',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [NODE_KINDS.KPI_OBSERVATION, NODE_KINDS.SLO_BREACH, NODE_KINDS.INCIDENT],
    edgeKinds: [EDGE_KINDS.MEASURES, EDGE_KINDS.BREACHES],
    requiresGate: false,
    maxWritesPerMinute: 60,
  },
  subscribes: ['context.ship.deployment_recorded'],
  healthEndpoint: 'http://localhost:7090/health',
  llmBudget: { maxTokensPerRun: 2000, preferredModel: 'claude-haiku-4-5-20251001' },
}

export class SreAgent extends BaseAgent {
  protected readonly agentId = 'sre:v1'
  protected readonly domain = 'ship' as const

  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) {
    super(adapter, llm)
  }

  async run(input: SreInput): Promise<SreOutput> {
    if (!input.service || !input.sliWindow) {
      this.fail('run', new Error('service and sliWindow are required'))
    }

    const sessionId = randomUUID()
    const inputHash = this.hashInput(input)
    const target = input.target ?? 0.99
    const sli = input.fixtureMetrics?.sli ?? target
    const healthy = sli >= target
    const kpiLabel = input.kpiLabel ?? `${input.service} SLI`

    const observationId = await this.writeNode({
      kind: NODE_KINDS.KPI_OBSERVATION,
      label: kpiLabel,
      description: JSON.stringify({
        service: input.service,
        sliWindow: input.sliWindow,
        target,
        sli,
        kpiLabel,
      }),
      metadata: {
        service: input.service,
        sliWindow: input.sliWindow,
        target,
        sli,
        healthy,
        kpiLabel,
      },
      eventKind: 'slo_evaluated',
      cycleId: input.cycleId,
    })

    if (input.deploymentId !== undefined) {
      await this.writeEdge(observationId, input.deploymentId, EDGE_KINDS.MEASURES)
    }

    let breachId: number | undefined

    if (!healthy) {
      breachId = await this.writeNode({
        kind: NODE_KINDS.SLO_BREACH,
        label: `SLO breach ${input.service}`,
        description: `SLI ${sli} below target ${target} for ${input.sliWindow}`,
        metadata: { service: input.service, sli, target, sliWindow: input.sliWindow },
        eventKind: 'slo_evaluated',
        cycleId: input.cycleId,
      })
      await this.writeEdge(observationId, breachId, EDGE_KINDS.BREACHES)

      const incidentId = await this.writeNode({
        kind: NODE_KINDS.INCIDENT,
        label: `Incident: ${input.service} SLO`,
        description: `Opened due to SLO breach (sli=${sli}, target=${target})`,
        metadata: { service: input.service, breachId, severity: 'high' },
        eventKind: 'slo_evaluated',
        cycleId: input.cycleId,
      })
      await this.writeEdge(breachId, incidentId, EDGE_KINDS.BREACHES)
    }

    const outputNodeIds = [observationId]
    if (breachId !== undefined) outputNodeIds.push(breachId)

    await this.adapter.episodicMemory.write({
      agentId: this.agentId,
      sessionId,
      domain: 'ship',
      cycleId: input.cycleId,
      inputHash,
      inputSummary: `service=${input.service} sli=${sli} target=${target}`,
      outputSummary: healthy ? 'healthy' : 'breach',
      outputNodeIds,
      confidencePct: 92,
    })

    return { observationId, breachId, healthy }
  }
}
