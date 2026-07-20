import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import { NODE_KINDS, EDGE_KINDS } from '@avp/shared'

export interface ReleaseManagerInput {
  buildId?: number
  scanNodeId?: number
  cycleId?: string
  featureId?: number
  environment?: string
  approvedBy?: string
  gateToken?: string
}

export interface ReleaseManagerOutput {
  ready: boolean
  reportId?: number
  blocking: boolean
}

export const RELEASE_MANAGER_MANIFEST: AgentManifest = {
  id: 'release-manager:v1',
  name: 'Release Manager Agent',
  archetype: 'Release Manager',
  domain: 'ship',
  runtime: 'pipeline',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [NODE_KINDS.READINESS_REPORT],
    edgeKinds: [EDGE_KINDS.BUNDLES, EDGE_KINDS.CLEARED_BY],
    requiresGate: false,
    maxWritesPerMinute: 30,
  },
  subscribes: [
    'context.ship.build_completed',
    'context.ship.security_scan_completed',
    'context.ship.cost_analyzed',
  ],
  healthEndpoint: 'http://localhost:7088/health',
  llmBudget: { maxTokensPerRun: 2000, preferredModel: 'claude-haiku-4-5-20251001' },
}

export class ReleaseManagerAgent extends BaseAgent {
  protected readonly agentId = 'release-manager:v1'
  protected readonly domain = 'ship' as const

  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) {
    super(adapter, llm)
  }

  async run(input: ReleaseManagerInput): Promise<ReleaseManagerOutput> {
    const sessionId = randomUUID()
    const inputHash = this.hashInput(input)
    const environment = (input.environment ?? 'staging').toLowerCase()

    if (input.scanNodeId !== undefined) {
      const rows = await this.adapter.graphRead<{ count: string | number }>(
        `SELECT COUNT(*)::int AS count FROM graph_edges WHERE from_node_id=$1 AND kind='BLOCKS_RELEASE'`,
        [input.scanNodeId],
      )
      const blockCount = Number(rows[0]?.count ?? 0)
      if (blockCount > 0) {
        const reportId = await this.writeNode({
          kind: NODE_KINDS.READINESS_REPORT,
          label: `Readiness blocked (scan ${input.scanNodeId})`,
          description: JSON.stringify({
            ready: false,
            blocking: true,
            scanNodeId: input.scanNodeId,
            buildId: input.buildId,
            environment,
          }),
          metadata: { ready: false, blocking: true, scanNodeId: input.scanNodeId },
          eventKind: 'readiness_reported',
          cycleId: input.cycleId,
          featureId: input.featureId,
        })

        await this.adapter.episodicMemory.write({
          agentId: this.agentId,
          sessionId,
          domain: 'ship',
          cycleId: input.cycleId,
          inputHash,
          inputSummary: `build=${input.buildId ?? 'n/a'} blocked by scan=${input.scanNodeId}`,
          outputSummary: `blocking=${blockCount}`,
          outputNodeIds: [reportId],
          confidencePct: 100,
        })
        return { ready: false, reportId, blocking: true }
      }
    }

    if (environment === 'production') {
      const bypass = process.env.AVP_GATE_BYPASS === '1'
      if (!bypass && !input.approvedBy && !input.gateToken) {
        this.fail('gate', new Error('production release requires approvedBy or gateToken (or AVP_GATE_BYPASS=1)'))
      }
    }

    const approvalSet = ['eng-lead', 'product']
    const reportPayload = {
      ready: true,
      approvalSet,
      buildId: input.buildId,
      scanNodeId: input.scanNodeId,
      environment,
      approvedBy: input.approvedBy,
      featureId: input.featureId,
    }

    const reportId = await this.writeNode({
      kind: NODE_KINDS.READINESS_REPORT,
      label: `Readiness report${input.buildId !== undefined ? ` build ${input.buildId}` : ''}`,
      description: JSON.stringify(reportPayload),
      metadata: {
        ready: true,
        approvalSet,
      },
      eventKind: 'release_candidate_ready',
      cycleId: input.cycleId,
      featureId: input.featureId,
    })

    if (input.buildId !== undefined) {
      await this.writeEdge(reportId, input.buildId, EDGE_KINDS.BUNDLES)
    }
    if (input.scanNodeId !== undefined) {
      await this.writeEdge(reportId, input.scanNodeId, EDGE_KINDS.CLEARED_BY)
    }

    await this.adapter.episodicMemory.write({
      agentId: this.agentId,
      sessionId,
      domain: 'ship',
      cycleId: input.cycleId,
      inputHash,
      inputSummary: `build=${input.buildId ?? 'n/a'} env=${environment}`,
      outputSummary: `report ${reportId} ready`,
      outputNodeIds: [reportId],
      confidencePct: 90,
    })

    return { ready: true, reportId, blocking: false }
  }
}
