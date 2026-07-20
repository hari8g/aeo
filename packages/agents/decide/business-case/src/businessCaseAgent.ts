import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import { NODE_KINDS, EDGE_KINDS } from '@avp/shared'

export interface BusinessCaseInput {
  painPointIds: number[]
  painPointLabels: string[]
  cycleId?: string
}

export interface BusinessCaseOutput {
  briefId: number
  featureId: number
}

type BriefDraft = {
  title: string
  problemStatement: string
  customerSegment: string
  evidenceSummary: string
  isDuplicate: boolean
  duplicateOf: string | null
  recommendation: string
}

export const BUSINESS_CASE_MANIFEST: AgentManifest = {
  id: 'business-case:v1',
  name: 'Business Case Agent',
  archetype: 'Business Analyst',
  domain: 'decide',
  runtime: 'studio',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [NODE_KINDS.BRIEF, NODE_KINDS.FEATURE],
    edgeKinds: [EDGE_KINDS.MOTIVATES, EDGE_KINDS.DUPLICATE_OF],
    requiresGate: false,
    maxWritesPerMinute: 20,
  },
  subscribes: ['context.listen.pain_point_clustered'],
  healthEndpoint: 'http://localhost:7091/health',
  llmBudget: { maxTokensPerRun: 6000, preferredModel: 'claude-sonnet-4-6' },
}

export class BusinessCaseAgent extends BaseAgent {
  protected readonly agentId = 'business-case:v1'
  protected readonly domain = 'decide' as const

  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) {
    super(adapter, llm)
  }

  async run(input: BusinessCaseInput): Promise<BusinessCaseOutput> {
    if (!input.painPointIds?.length) this.fail('run', new Error('painPointIds required'))
    if (!input.painPointLabels?.length) this.fail('run', new Error('painPointLabels required'))

    const sessionId = randomUUID()
    const inputHash = this.hashInput([...input.painPointLabels].sort())
    let tokensUsed = 0

    const past = await this.adapter.episodicMemory.readSimilar(this.agentId, inputHash, 3)
    const pastSummaries = past
      .map((p) => (p as { outputSummary?: string; output_summary?: string }).outputSummary
        ?? (p as { output_summary?: string }).output_summary)
      .filter(Boolean)
    const dedupeContext = pastSummaries.length > 0
      ? `Previous similar briefs:\n${pastSummaries.map((s) => `- ${s}`).join('\n')}\nAvoid duplicating these.`
      : ''

    const existing = await this.adapter.graphRead<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE kind=$1 ORDER BY created_at DESC LIMIT 20`,
      [NODE_KINDS.FEATURE],
    )

    let llmText = ''
    try {
      const res = await this.complete({
        model: 'claude-sonnet-4-6',
        system: 'You are a Business Analyst writing intake briefs. Be concise, evidence-based, and use plain language.',
        maxTokens: 2000,
        messages: [{
          role: 'user',
          content: `Write a structured intake brief for these customer pain points.\n${dedupeContext}\n\nPain points:\n${input.painPointLabels.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n\nExisting features (avoid duplicating):\n${existing.map((e) => e.label).join('\n')}\n\nReturn JSON only:\n{"title":"Feature title","problemStatement":"1-2 sentence problem statement","customerSegment":"Who is most affected","evidenceSummary":"What the signals tell us","isDuplicate":false,"duplicateOf":null,"recommendation":"brief recommendation"}`,
        }],
      })
      llmText = res.text
      tokensUsed = res.tokensUsed.output
    } catch {
      /* stub fallback */
    }

    const parsed = this.parse(llmText, input.painPointLabels)

    const briefId = await this.writeNode({
      kind: NODE_KINDS.BRIEF,
      label: `Brief: ${parsed.title}`.slice(0, 120),
      description: JSON.stringify(parsed),
      metadata: { isDuplicate: parsed.isDuplicate },
      eventKind: 'brief_written',
      cycleId: input.cycleId,
    })

    const featureId = await this.writeNode({
      kind: NODE_KINDS.FEATURE,
      label: parsed.title.slice(0, 120),
      description: parsed.problemStatement,
      metadata: { stage: 'INTAKE', cycleId: input.cycleId ?? null },
      eventKind: 'feature_created',
      cycleId: input.cycleId,
    })

    for (const ppId of input.painPointIds) {
      await this.writeEdge(ppId, featureId, EDGE_KINDS.MOTIVATES)
    }
    await this.writeEdge(briefId, featureId, EDGE_KINDS.MOTIVATES)

    if (parsed.isDuplicate && parsed.duplicateOf) {
      const dup = existing.find((e) => e.label === parsed.duplicateOf)
      if (dup) await this.writeEdge(featureId, dup.id, EDGE_KINDS.DUPLICATE_OF)
    }

    await this.adapter.episodicMemory.write({
      agentId: this.agentId,
      sessionId,
      domain: 'decide',
      cycleId: input.cycleId,
      inputHash,
      inputSummary: input.painPointLabels.join(', '),
      outputSummary: `Brief: ${parsed.title} (feature ${featureId})`,
      outputNodeIds: [briefId, featureId],
      confidencePct: 85,
      llmTokensUsed: tokensUsed,
    })

    return { briefId, featureId }
  }

  private parse(raw: string, labels: string[]): BriefDraft {
    const fallback: BriefDraft = {
      title: labels[0] ?? 'Untitled feature',
      problemStatement: 'Stub problem statement pending LLM',
      customerSegment: 'General customers',
      evidenceSummary: labels.join('; '),
      isDuplicate: false,
      duplicateOf: null,
      recommendation: 'Proceed to value assessment',
    }

    try {
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      if (start < 0 || end <= start) return fallback
      const p = JSON.parse(raw.slice(start, end + 1)) as Partial<BriefDraft>
      return {
        title: p.title ?? fallback.title,
        problemStatement: p.problemStatement ?? fallback.problemStatement,
        customerSegment: p.customerSegment ?? fallback.customerSegment,
        evidenceSummary: p.evidenceSummary ?? fallback.evidenceSummary,
        isDuplicate: Boolean(p.isDuplicate),
        duplicateOf: p.duplicateOf ?? null,
        recommendation: p.recommendation ?? fallback.recommendation,
      }
    } catch {
      return fallback
    }
  }
}
