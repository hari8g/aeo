import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import { NODE_KINDS, EDGE_KINDS } from '@avp/shared'

export interface DeploymentEngineerInput {
  reportId?: number
  rcNodeId?: number
  environment: string
  status: 'deployed' | 'failed' | 'rolled_back'
  cycleId?: string
}

export interface DeploymentEngineerOutput {
  deploymentId: number
  envTargetId: number
}

export const DEPLOYMENT_ENGINEER_MANIFEST: AgentManifest = {
  id: 'deployment-engineer:v1',
  name: 'Deployment Engineer Agent',
  archetype: 'Deployment Engineer',
  domain: 'ship',
  runtime: 'pipeline',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [NODE_KINDS.DEPLOYMENT, NODE_KINDS.ENV_TARGET],
    edgeKinds: [EDGE_KINDS.DEPLOYS_TO],
    requiresGate: false,
    maxWritesPerMinute: 60,
  },
  subscribes: ['context.ship.release_candidate_ready'],
  healthEndpoint: 'http://localhost:7089/health',
  llmBudget: { maxTokensPerRun: 1000, preferredModel: 'claude-haiku-4-5-20251001' },
}

export class DeploymentEngineerAgent extends BaseAgent {
  protected readonly agentId = 'deployment-engineer:v1'
  protected readonly domain = 'ship' as const

  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) {
    super(adapter, llm)
  }

  async run(input: DeploymentEngineerInput): Promise<DeploymentEngineerOutput> {
    const sourceId = input.reportId ?? input.rcNodeId
    if (sourceId === undefined || !input.environment || !input.status) {
      this.fail('run', new Error('reportId or rcNodeId, environment, and status are required'))
    }
    const readinessNodeId = sourceId as number

    const sessionId = randomUUID()
    const inputHash = this.hashInput(input)

    const envTargetId = await this.writeNode({
      kind: NODE_KINDS.ENV_TARGET,
      label: input.environment,
      description: `Environment target: ${input.environment}`,
      metadata: { environment: input.environment },
      eventKind: 'deployment_recorded',
      cycleId: input.cycleId,
    })

    const deploymentId = await this.writeNode({
      kind: NODE_KINDS.DEPLOYMENT,
      label: `Deploy ${readinessNodeId} → ${input.environment}`,
      description: JSON.stringify({
        reportId: input.reportId,
        rcNodeId: input.rcNodeId,
        environment: input.environment,
        status: input.status,
      }),
      metadata: {
        status: input.status,
        environment: input.environment,
        reportId: input.reportId,
        rcNodeId: input.rcNodeId,
      },
      eventKind: 'deployment_recorded',
      cycleId: input.cycleId,
    })

    await this.writeEdge(deploymentId, envTargetId, EDGE_KINDS.DEPLOYS_TO)
    await this.writeEdge(readinessNodeId, deploymentId, EDGE_KINDS.DEPLOYS_TO)

    await this.adapter.episodicMemory.write({
      agentId: this.agentId,
      sessionId,
      domain: 'ship',
      cycleId: input.cycleId,
      inputHash,
      inputSummary: `source=${readinessNodeId} env=${input.environment} status=${input.status}`,
      outputSummary: `deployment=${deploymentId}`,
      outputNodeIds: [deploymentId, envTargetId],
      confidencePct: 95,
    })

    return { deploymentId, envTargetId }
  }
}
