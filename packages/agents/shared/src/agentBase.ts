import { createHash, randomUUID } from 'node:crypto'
import type {
  IRuntimeAdapter,
  ILLMGateway,
  LLMRequest,
  LLMResponse,
  VerbDomain,
  GraphWriteResult,
} from '@avp/shared'

export type WriteNodeParams = {
  kind: string
  label: string
  description?: string
  metadata?: Record<string, unknown>
  eventKind: string
  cycleId?: string
  featureId?: number
}

/**
 * Abstract base for all AVP domain agents.
 * Subclasses provide agentId/domain and implement domain-specific `run()` methods.
 */
export abstract class BaseAgent {
  protected abstract readonly agentId: string
  protected abstract readonly domain: VerbDomain

  constructor(
    protected readonly adapter: IRuntimeAdapter,
    protected readonly llm: ILLMGateway,
  ) {}

  /** Hash the input payload for episodic memory lookup */
  protected hashInput(input: unknown): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex')
  }

  /** Complete with the LLM, attributing usage to this agent */
  protected async complete(req: Omit<LLMRequest, 'agentId'>): Promise<LLMResponse> {
    return this.llm.complete({ ...req, agentId: this.agentId })
  }

  /**
   * Upsert a graph node and publish a context-bus event in one call.
   * Returns the created/updated node id.
   */
  protected async writeNode(params: WriteNodeParams): Promise<number> {
    let result: GraphWriteResult
    try {
      result = await this.adapter.graphWrite({
        type: 'upsertNode',
        kind: params.kind,
        label: params.label,
        description: params.description,
        metadata: params.metadata,
      })
    } catch (err) {
      this.fail('writeNode', err)
    }

    const nodeId = result.nodeId
    if (nodeId === undefined) {
      this.fail('writeNode', new Error('Platform returned no nodeId'))
    }

    await this.adapter.publish({
      traceId: result.traceId,
      spanId: randomUUID(),
      domain: this.domain,
      kind: params.eventKind,
      graphDelta: { nodesCreated: [nodeId], edgesCreated: [] },
      cycleId: params.cycleId,
      featureId: params.featureId,
      runtime: this.adapter.runtime,
    })

    return nodeId
  }

  /** Insert a typed graph edge between two node ids */
  protected async writeEdge(
    fromId: number,
    toId: number,
    kind: string,
    weight = 1.0,
    metadata?: Record<string, unknown>,
  ): Promise<number | undefined> {
    try {
      const result = await this.adapter.graphWrite({
        type: 'insertEdge',
        fromId,
        toId,
        kind,
        weight,
        metadata,
      })
      return result.edgeId
    } catch (err) {
      this.fail('writeEdge', err)
    }
  }

  /** Log and re-throw with agent + stage context */
  protected fail(stage: string, err: unknown): never {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[${this.agentId}] Error in ${stage}: ${msg}`)
    throw new Error(`${this.agentId}/${stage}: ${msg}`)
  }
}
