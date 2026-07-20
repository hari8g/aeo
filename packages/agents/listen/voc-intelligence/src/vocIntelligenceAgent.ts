import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'

export interface VoCSignal {
  date: string
  cohort: string
  type: string
  text: string
}

export interface VoCInput {
  signals: VoCSignal[]
  cycleId?: string
}

export interface VoCOutput {
  painPointIds: number[]
  clusterCount: number
  topProblem: string
}

type Cluster = {
  label: string
  description: string
  importance_score: number
  signal_indices: number[]
}

export const VOC_MANIFEST: AgentManifest = {
  id: 'voc-intelligence:v1',
  name: 'VoC Intelligence Agent',
  archetype: 'Market Research Analyst',
  domain: 'listen',
  runtime: 'studio',
  version: '1.0.0',
  capabilities: {
    nodeKinds: ['CUSTOMER_SIGNAL', 'PAIN_POINT'],
    edgeKinds: ['EXPRESSES'],
    requiresGate: false,
    maxWritesPerMinute: 120,
  },
  subscribes: [],
  healthEndpoint: 'http://localhost:7081/health',
  llmBudget: { maxTokensPerRun: 8000, preferredModel: 'claude-sonnet-4-6' },
}

export class VoCIntelligenceAgent extends BaseAgent {
  protected readonly agentId = 'voc-intelligence:v1'
  protected readonly domain = 'listen' as const

  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) {
    super(adapter, llm)
  }

  async run(input: VoCInput): Promise<VoCOutput> {
    if (!input.signals?.length) {
      this.fail('run', new Error('VoCInput.signals must be a non-empty array'))
    }

    const sessionId = randomUUID()
    const inputHash = this.hashInput(input.signals.map((s) => s.text).sort())
    const painPointIds: number[] = []

    // 1. Ingest raw signals
    const signalIds: number[] = []
    for (const sig of input.signals) {
      const id = await this.writeNode({
        kind: 'CUSTOMER_SIGNAL',
        label: sig.text.slice(0, 80),
        description: JSON.stringify(sig),
        metadata: { cohort: sig.cohort, type: sig.type, date: sig.date },
        eventKind: 'signal_ingested',
        cycleId: input.cycleId,
      })
      signalIds.push(id)
    }

    // 2. Read past similar episodes to calibrate clustering
    const past = await this.adapter.episodicMemory.readSimilar(this.agentId, inputHash, 3)
    const pastSummaries = past
      .map((p) => (p as { outputSummary?: string; output_summary?: string }).outputSummary
        ?? (p as { output_summary?: string }).output_summary)
      .filter(Boolean)
    const pastContext =
      pastSummaries.length > 0
        ? `Previous similar clustering runs found: ${pastSummaries.join('; ')}`
        : ''

    // 3. Cluster with LLM
    const prompt = `You are a Voice of Customer analyst. Cluster these ${input.signals.length} customer feedback items into 2-5 named pain points.

${pastContext ? `Context from prior runs:\n${pastContext}\n` : ''}
Feedback:
${input.signals.map((s, i) => `${i + 1}. [${s.cohort}] ${s.text}`).join('\n')}

Return JSON ONLY — no preamble:
{
  "clusters": [
    {
      "label": "Short pain point name (max 60 chars)",
      "description": "One sentence problem statement",
      "importance_score": 0.0-1.0,
      "signal_indices": [1,2,3]
    }
  ]
}`

    const llmResult = await this.complete({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2000,
    })

    const clusters = this.parseClusters(llmResult.text, input.signals.length)

    // 4. Write PAIN_POINT nodes + EXPRESSES edges
    for (const cluster of clusters) {
      const ppId = await this.writeNode({
        kind: 'PAIN_POINT',
        label: cluster.label.slice(0, 60),
        description: cluster.description,
        metadata: {
          importanceScore: cluster.importance_score,
          signalCount: cluster.signal_indices.length,
        },
        eventKind: 'pain_point_clustered',
        cycleId: input.cycleId,
      })
      painPointIds.push(ppId)
      for (const idx of cluster.signal_indices) {
        const sigId = signalIds[idx - 1]
        if (sigId) await this.writeEdge(sigId, ppId, 'EXPRESSES')
      }
    }

    // 5. Record episode
    await this.adapter.episodicMemory.write({
      agentId: this.agentId,
      sessionId,
      domain: 'listen',
      cycleId: input.cycleId,
      inputHash,
      inputSummary: `${input.signals.length} signals`,
      outputSummary: `${clusters.length} pain points: ${clusters.map((c) => c.label).join(', ')}`,
      outputNodeIds: painPointIds,
      confidencePct: 80,
      llmTokensUsed: llmResult.tokensUsed.output,
    })

    const top = [...clusters].sort((a, b) => b.importance_score - a.importance_score)[0]

    return {
      painPointIds,
      clusterCount: clusters.length,
      topProblem: top?.label ?? 'Unknown',
    }
  }

  private parseClusters(raw: string, signalCount: number): Cluster[] {
    const fallback: Cluster[] = [
      {
        label: 'General feedback',
        description: 'Customer feedback requiring analysis',
        importance_score: 0.5,
        signal_indices: Array.from({ length: signalCount }, (_, i) => i + 1),
      },
    ]

    try {
      const trimmed = raw.trim()
      const jsonStart = trimmed.indexOf('{')
      const jsonEnd = trimmed.lastIndexOf('}')
      if (jsonStart === -1 || jsonEnd === -1) return fallback
      const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as { clusters?: Cluster[] }
      if (!Array.isArray(parsed.clusters) || parsed.clusters.length === 0) return fallback
      return parsed.clusters.map((c) => ({
        label: String(c.label ?? 'Untitled pain point'),
        description: String(c.description ?? ''),
        importance_score: Number(c.importance_score ?? 0.5),
        signal_indices: Array.isArray(c.signal_indices) ? c.signal_indices.map(Number) : fallback[0].signal_indices,
      }))
    } catch {
      return fallback
    }
  }
}
