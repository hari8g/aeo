import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import { NODE_KINDS, EDGE_KINDS } from '@avp/shared'

export interface DevOpsInput {
  gitSha: string
  runId: string
  conclusion: string
  cycleId?: string
  featureId?: number
}

export interface DevOpsOutput {
  buildId: number
  summary: string
}

export const DEVOPS_MANIFEST: AgentManifest = {
  id: 'devops:v1',
  name: 'DevOps Agent',
  archetype: 'DevOps Engineer',
  domain: 'ship',
  runtime: 'pipeline',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [NODE_KINDS.BUILD, NODE_KINDS.IAC_CHANGESET],
    edgeKinds: [EDGE_KINDS.PRODUCED, EDGE_KINDS.FAILED_AT],
    requiresGate: false,
    maxWritesPerMinute: 60,
  },
  subscribes: [],
  healthEndpoint: 'http://localhost:7086/health',
  llmBudget: { maxTokensPerRun: 2000, preferredModel: 'claude-haiku-4-5-20251001' },
}

export class DevOpsAgent extends BaseAgent {
  protected readonly agentId = 'devops:v1'
  protected readonly domain = 'ship' as const

  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) {
    super(adapter, llm)
  }

  async run(input: DevOpsInput): Promise<DevOpsOutput> {
    if (!input.gitSha || !input.runId || !input.conclusion) {
      this.fail('run', new Error('gitSha, runId, and conclusion are required'))
    }

    const sessionId = randomUUID()
    const inputHash = this.hashInput(input)
    const failed = /fail/i.test(input.conclusion)

    const buildId = await this.writeNode({
      kind: NODE_KINDS.BUILD,
      label: `Build ${input.gitSha.slice(0, 8)}`,
      description: JSON.stringify({
        sha: input.gitSha,
        runId: input.runId,
        conclusion: input.conclusion,
      }),
      metadata: {
        conclusion: input.conclusion,
        gitSha: input.gitSha,
        runId: input.runId,
      },
      eventKind: 'build_completed',
      cycleId: input.cycleId,
      featureId: input.featureId,
    })

    const iacId = await this.writeNode({
      kind: NODE_KINDS.IAC_CHANGESET,
      label: failed ? 'iac-failed' : 'iac-changeset',
      description: `IaC changeset for run ${input.runId}`,
      metadata: { runId: input.runId, gitSha: input.gitSha, conclusion: input.conclusion },
      eventKind: 'build_completed',
      cycleId: input.cycleId,
      featureId: input.featureId,
    })

    await this.writeEdge(buildId, iacId, EDGE_KINDS.PRODUCED)
    if (failed) {
      await this.writeEdge(buildId, iacId, EDGE_KINDS.FAILED_AT)
    }

    const summary = failed
      ? `Build ${input.gitSha.slice(0, 8)} failed (run ${input.runId})`
      : `Build ${input.gitSha.slice(0, 8)} ${input.conclusion} (run ${input.runId})`

    await this.adapter.episodicMemory.write({
      agentId: this.agentId,
      sessionId,
      domain: 'ship',
      cycleId: input.cycleId,
      featureId: input.featureId,
      inputHash,
      inputSummary: `run=${input.runId} sha=${input.gitSha.slice(0, 8)} conclusion=${input.conclusion}`,
      outputSummary: summary,
      outputNodeIds: [buildId, iacId],
      confidencePct: 95,
    })

    return { buildId, summary }
  }
}
