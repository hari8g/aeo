import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import { NODE_KINDS, EDGE_KINDS } from '@avp/shared'

export interface FinOpsInput {
  repoPath: string
  gitSha: string
  cycleId?: string
  fixtureCost?: number
  threshold?: number
}

export interface FinOpsOutput {
  estimateId: number
  alertId?: number
  monthlyCost: number
  exceeds: boolean
}

export const FINOPS_MANIFEST: AgentManifest = {
  id: 'finops:v1',
  name: 'FinOps Agent',
  archetype: 'FinOps Analyst',
  domain: 'ship',
  runtime: 'pipeline',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [NODE_KINDS.COST_ESTIMATE, NODE_KINDS.COST_ALERT],
    edgeKinds: [EDGE_KINDS.FORECASTS, EDGE_KINDS.EXCEEDS],
    requiresGate: false,
    maxWritesPerMinute: 60,
  },
  subscribes: ['context.ship.build_completed'],
  healthEndpoint: 'http://localhost:7087/health',
  llmBudget: { maxTokensPerRun: 2000, preferredModel: 'claude-haiku-4-5-20251001' },
}

export class FinOpsAgent extends BaseAgent {
  protected readonly agentId = 'finops:v1'
  protected readonly domain = 'ship' as const

  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) {
    super(adapter, llm)
  }

  async run(input: FinOpsInput): Promise<FinOpsOutput> {
    if (!input.repoPath || !input.gitSha) {
      this.fail('run', new Error('repoPath and gitSha are required'))
    }

    const sessionId = randomUUID()
    const inputHash = this.hashInput(input)
    const monthlyCost = input.fixtureCost ?? 100
    const threshold = input.threshold ?? 500
    const exceeds = monthlyCost > threshold

    const estimateId = await this.writeNode({
      kind: NODE_KINDS.COST_ESTIMATE,
      label: `Cost estimate ${input.gitSha.slice(0, 8)}`,
      description: JSON.stringify({
        repoPath: input.repoPath,
        gitSha: input.gitSha,
        monthlyCost,
        threshold,
      }),
      metadata: { monthlyCost, threshold, gitSha: input.gitSha, repoPath: input.repoPath },
      eventKind: 'cost_analyzed',
      cycleId: input.cycleId,
    })

    let alertId: number | undefined
    if (exceeds) {
      alertId = await this.writeNode({
        kind: NODE_KINDS.COST_ALERT,
        label: `Cost alert $${monthlyCost}/mo`,
        description: `Monthly cost ${monthlyCost} exceeds threshold ${threshold}`,
        metadata: { monthlyCost, threshold, gitSha: input.gitSha },
        eventKind: 'cost_anomaly_detected',
        cycleId: input.cycleId,
      })
      await this.writeEdge(estimateId, alertId, EDGE_KINDS.FORECASTS)
      await this.writeEdge(estimateId, alertId, EDGE_KINDS.EXCEEDS)
    }

    await this.adapter.episodicMemory.write({
      agentId: this.agentId,
      sessionId,
      domain: 'ship',
      cycleId: input.cycleId,
      inputHash,
      inputSummary: `sha=${input.gitSha.slice(0, 8)} cost=${monthlyCost}`,
      outputSummary: exceeds
        ? `exceeds threshold: $${monthlyCost} > $${threshold}`
        : `within budget: $${monthlyCost}`,
      outputNodeIds: alertId !== undefined ? [estimateId, alertId] : [estimateId],
      confidencePct: 90,
    })

    return { estimateId, alertId, monthlyCost, exceeds }
  }
}
