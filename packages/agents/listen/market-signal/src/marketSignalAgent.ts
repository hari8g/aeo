import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import { NODE_KINDS, EDGE_KINDS } from '@avp/shared'

export interface MarketSource {
  url?: string
  text: string
  type: 'news' | 'review' | 'competitor' | 'analyst'
}

export interface MarketSignalInput {
  sources: MarketSource[]
  cycleId?: string
}

export interface MarketSignalOutput {
  signalIds: number[]
  trendIds: number[]
}

type TrendDraft = {
  label: string
  description: string
  confidence: number
  signalIndices: number[]
}

export const MARKET_SIGNAL_MANIFEST: AgentManifest = {
  id: 'market-signal:v1',
  name: 'Market Signal Agent',
  archetype: 'Competitive Intelligence Analyst',
  domain: 'listen',
  runtime: 'worker',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [NODE_KINDS.MARKET_SIGNAL, NODE_KINDS.COMPETITOR_MOVE, NODE_KINDS.TREND],
    edgeKinds: [EDGE_KINDS.RELATES_TO],
    requiresGate: false,
    maxWritesPerMinute: 30,
  },
  subscribes: [],
  healthEndpoint: 'http://localhost:7082/health',
  llmBudget: { maxTokensPerRun: 4000, preferredModel: 'claude-sonnet-4-6' },
}

export class MarketSignalAgent extends BaseAgent {
  protected readonly agentId = 'market-signal:v1'
  protected readonly domain = 'listen' as const

  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) {
    super(adapter, llm)
  }

  async run(input: MarketSignalInput): Promise<MarketSignalOutput> {
    if (!input.sources?.length) this.fail('run', new Error('sources required'))

    const sessionId = randomUUID()
    const inputHash = this.hashInput(input.sources.map((s) => s.text).sort())
    const signalIds: number[] = []
    const trendIds: number[] = []
    let tokensUsed = 0

    for (const src of input.sources) {
      const id = await this.writeNode({
        kind: NODE_KINDS.MARKET_SIGNAL,
        label: src.text.slice(0, 80),
        description: JSON.stringify(src),
        metadata: { type: src.type, url: src.url ?? null },
        eventKind: 'market_signal_ingested',
        cycleId: input.cycleId,
      })
      signalIds.push(id)
    }

    let llmText = ''
    try {
      const res = await this.complete({
        model: 'claude-sonnet-4-6',
        maxTokens: 1000,
        messages: [{
          role: 'user',
          content: `Identify 1-3 market trends from these signals. Return JSON only: {"trends":[{"label":"...","description":"...","confidence":0.0-1.0,"signalIndices":[1,2]}]}\n\n${input.sources.map((s, i) => `${i + 1}. [${s.type}] ${s.text}`).join('\n')}`,
        }],
      })
      llmText = res.text
      tokensUsed = res.tokensUsed.output
    } catch {
      /* stub-friendly: fall back below */
    }

    const trends = this.parseTrends(llmText, input.sources.length)
    for (const t of trends) {
      const tid = await this.writeNode({
        kind: NODE_KINDS.TREND,
        label: t.label.slice(0, 120),
        description: t.description,
        metadata: { confidence: t.confidence },
        eventKind: 'trend_identified',
        cycleId: input.cycleId,
      })
      trendIds.push(tid)
      for (const idx of t.signalIndices) {
        const sid = signalIds[idx - 1]
        if (sid !== undefined) await this.writeEdge(sid, tid, EDGE_KINDS.RELATES_TO)
      }
    }

    await this.adapter.episodicMemory.write({
      agentId: this.agentId,
      sessionId,
      domain: 'listen',
      cycleId: input.cycleId,
      inputHash,
      inputSummary: `${input.sources.length} sources`,
      outputSummary: `${signalIds.length} signals, ${trendIds.length} trends`,
      outputNodeIds: [...signalIds, ...trendIds],
      confidencePct: 70,
      llmTokensUsed: tokensUsed,
    })

    return { signalIds, trendIds }
  }

  private parseTrends(raw: string, signalCount: number): TrendDraft[] {
    const fallback: TrendDraft[] = [{
      label: 'Market trend (stub)',
      description: 'Aggregated trend across ingested signals',
      confidence: 0.5,
      signalIndices: Array.from({ length: signalCount }, (_, i) => i + 1),
    }]

    try {
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      if (start < 0 || end <= start) return fallback
      const parsed = JSON.parse(raw.slice(start, end + 1)) as {
        trends?: Array<{
          label?: string
          description?: string
          confidence?: number
          signalIndices?: number[]
        }>
      }
      if (!parsed.trends?.length) return fallback
      return parsed.trends.map((t) => ({
        label: t.label ?? 'Untitled trend',
        description: t.description ?? '',
        confidence: Number(t.confidence ?? 0.5),
        signalIndices: Array.isArray(t.signalIndices) && t.signalIndices.length
          ? t.signalIndices.map(Number)
          : fallback[0].signalIndices,
      }))
    } catch {
      return fallback
    }
  }
}
