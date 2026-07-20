// ── Runtime identifiers ────────────────────────────────────────────────────
export type RuntimeId =
  | 'studio'
  | 'engineering'
  | 'pipeline'
  | 'observability'
  | 'collaboration'
  | 'worker'

// ── Domain verbs ───────────────────────────────────────────────────────────
export type VerbDomain = 'listen' | 'decide' | 'define' | 'build' | 'ship' | 'learn'

// ── Agent manifest — submitted on registration ─────────────────────────────
export interface AgentManifest {
  id: string                     // 'devsecops-agent:v1'
  name: string                   // 'DevSecOps Agent'
  archetype: string              // 'DevSecOps Engineer'
  domain: VerbDomain
  runtime: RuntimeId
  version: string
  capabilities: {
    nodeKinds: string[]          // graph_nodes.kind values this agent may write
    edgeKinds: string[]          // graph_edges.kind values this agent may create
    requiresGate: boolean        // writes must be preceded by human gate
    maxWritesPerMinute: number   // rate limit
  }
  subscribes: string[]           // NATS/Kafka topic patterns
  healthEndpoint: string
  llmBudget?: {
    maxTokensPerRun: number
    preferredModel: string
  }
}

// ── JWT payload per agent ──────────────────────────────────────────────────
export interface AgentJwtPayload {
  sub: string
  iss: string
  aud: string
  runtime: RuntimeId
  domain: VerbDomain
  nodeKinds: string[]
  edgeKinds: string[]
  requiresGate: boolean
  maxWritesPerMinute: number
  iat: number
  exp: number
}

// ── Context bus event ──────────────────────────────────────────────────────
export interface AgentContextEvent {
  id: string                     // UUIDv4
  traceId: string                // W3C traceparent, propagate in all downstream spans
  spanId: string
  agentId: string
  runtime: RuntimeId
  domain: VerbDomain
  kind: string                   // 'security_scan_completed' | 'hypothesis_committed' | …
  graphDelta: { nodesCreated: number[]; edgesCreated: number[] }
  metadata?: Record<string, unknown>
  cycleId?: string
  featureId?: number
  ts: number
}

// ── Graph operations ───────────────────────────────────────────────────────
export type GraphWriteOp =
  | {
      type: 'upsertNode'
      kind: string
      label: string
      description?: string
      metadata?: Record<string, unknown>
    }
  | {
      type: 'insertEdge'
      fromId: number
      toId: number
      kind: string
      weight?: number
      metadata?: Record<string, unknown>
    }

export interface GraphWriteResult {
  nodeId?: number
  edgeId?: number
  agentId: string
  traceId: string
  ts: number
}

// ── Runtime adapter contract ───────────────────────────────────────────────
export interface IWorkingMemory {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>
  delete(key: string): Promise<void>
}

export interface EpisodeRecord {
  agentId: string
  sessionId: string
  domain: VerbDomain
  cycleId?: string
  featureId?: number
  inputHash: string
  inputSummary?: string
  systemPromptExcerpt?: string
  outputSummary?: string
  outputNodeIds?: number[]
  confidencePct?: number
  latencyMs?: number
  llmTokensUsed?: number
}

export interface IEpisodicMemory {
  write(episode: EpisodeRecord): Promise<number>
  readSimilar(
    agentId: string,
    inputHash: string,
    limit?: number,
  ): Promise<(EpisodeRecord & { id: number; outcomeLabel?: string })[]>
  linkOutcome(episodeId: number, outcomeNodeId: number): Promise<void>
}

export interface IRuntimeAdapter {
  readonly agentId: string
  readonly runtime: RuntimeId
  readonly jwt: string
  graphWrite(op: GraphWriteOp): Promise<GraphWriteResult>
  graphRead<T>(sql: string, params?: unknown[]): Promise<T[]>
  publish(event: Omit<AgentContextEvent, 'id' | 'agentId' | 'ts'>): Promise<void>
  subscribe(pattern: string, handler: (e: AgentContextEvent) => Promise<void>): () => void
  workingMemory: IWorkingMemory
  episodicMemory: IEpisodicMemory
  health(): Promise<{ status: 'ok' | 'degraded'; detail?: string }>
  shutdown(): Promise<void>
}

// ── LLM Gateway types ──────────────────────────────────────────────────────
export type LLMProvider = 'anthropic' | 'openai' | 'azure-openai' | 'aws-bedrock'

export interface LLMRequest {
  model: string
  system?: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  maxTokens?: number
  temperature?: number
  agentId: string
}

export interface LLMResponse {
  text: string
  provider: LLMProvider
  tokensUsed: { input: number; output: number }
  cached: boolean
}

export interface ILLMGateway {
  complete(req: LLMRequest): Promise<LLMResponse>
  isAvailable(): Promise<boolean>
}

export * from './graphKinds.js'
