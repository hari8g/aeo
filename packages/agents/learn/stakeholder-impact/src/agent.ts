import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import { NODE_KINDS, EDGE_KINDS } from '@avp/shared'

export interface StakeholderFeedback {
  stakeholder: string
  text: string
}

export interface StakeholderImpactInput {
  featureId: number
  feedback: StakeholderFeedback[]
  cycleId?: string
}

export interface StakeholderImpactOutput {
  assessmentId: number
  sentimentIds: number[]
}

export const STAKEHOLDER_IMPACT_MANIFEST: AgentManifest = {
  id: 'stakeholder-impact:v1',
  name: 'Stakeholder Impact Agent',
  archetype: 'Change Impact Analyst',
  domain: 'learn',
  runtime: 'collaboration',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [NODE_KINDS.IMPACT_ASSESSMENT, NODE_KINDS.SENTIMENT],
    edgeKinds: [EDGE_KINDS.IMPACTS],
    requiresGate: false,
    maxWritesPerMinute: 60,
  },
  subscribes: ['context.learn.verdict_recorded'],
  healthEndpoint: 'http://localhost:7093/health',
  llmBudget: { maxTokensPerRun: 3000, preferredModel: 'claude-sonnet-4-6' },
}

export class StakeholderImpactAgent extends BaseAgent {
  protected readonly agentId = 'stakeholder-impact:v1'
  protected readonly domain = 'learn' as const

  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) {
    super(adapter, llm)
  }

  async run(input: StakeholderImpactInput): Promise<StakeholderImpactOutput> {
    if (input.featureId === undefined || !input.feedback?.length) {
      this.fail('run', new Error('featureId and feedback are required'))
    }

    const sessionId = randomUUID()
    const inputHash = this.hashInput(input)

    const llm = await this.complete({
      model: 'claude-sonnet-4-6',
      maxTokens: 1500,
      messages: [{
        role: 'user',
        content: `Assess stakeholder impact for feature ${input.featureId}.
Feedback:
${input.feedback.map((f, i) => `${i + 1}. [${f.stakeholder}] ${f.text}`).join('\n')}
Return JSON ONLY: {"summary":"...","items":[{"index":1,"impact":"...","sentiment":"positive|neutral|negative","score":0.0}]}`,
      }],
    })

    const assessed = this.parse(llm.text, input.feedback)

    const assessmentId = await this.writeNode({
      kind: NODE_KINDS.IMPACT_ASSESSMENT,
      label: `Impact assessment feature ${input.featureId}`,
      description: assessed.summary,
      metadata: {
        featureId: input.featureId,
        stakeholderCount: input.feedback.length,
        items: assessed.items,
      },
      eventKind: 'impact_assessed',
      cycleId: input.cycleId,
      featureId: input.featureId,
    })
    await this.writeEdge(assessmentId, input.featureId, EDGE_KINDS.IMPACTS)

    const sentimentIds: number[] = []
    for (let i = 0; i < assessed.items.length; i++) {
      const item = assessed.items[i]
      const fb = input.feedback[i]

      const sentimentId = await this.writeNode({
        kind: NODE_KINDS.SENTIMENT,
        label: `${fb.stakeholder} ${item.sentiment}`,
        description: fb.text,
        metadata: {
          stakeholder: fb.stakeholder,
          sentiment: item.sentiment,
          score: item.score,
          impact: item.impact,
        },
        eventKind: 'sentiment_recorded',
        cycleId: input.cycleId,
        featureId: input.featureId,
      })
      sentimentIds.push(sentimentId)
      await this.writeEdge(assessmentId, sentimentId, EDGE_KINDS.IMPACTS)
    }

    await this.adapter.episodicMemory.write({
      agentId: this.agentId,
      sessionId,
      domain: 'learn',
      cycleId: input.cycleId,
      featureId: input.featureId,
      inputHash,
      inputSummary: `feature=${input.featureId} feedback=${input.feedback.length}`,
      outputSummary: assessed.summary,
      outputNodeIds: [assessmentId, ...sentimentIds],
      confidencePct: 70,
      llmTokensUsed: llm.tokensUsed.output,
    })

    return { assessmentId, sentimentIds }
  }

  private parse(raw: string, feedback: StakeholderFeedback[]) {
    type Item = { impact: string; sentiment: string; score: number }
    const stubItems = (): Item[] =>
      feedback.map((f) => ({
        impact: f.text.slice(0, 120) || 'Impact noted',
        sentiment: /neg|bad|frustrat|angry/i.test(f.text)
          ? 'negative'
          : /pos|good|love|great/i.test(f.text)
            ? 'positive'
            : 'neutral',
        score: 0.5,
      }))

    try {
      const s = raw.indexOf('{')
      const e = raw.lastIndexOf('}')
      if (s >= 0 && e > s) {
        const p = JSON.parse(raw.slice(s, e + 1)) as {
          summary?: string
          items?: Array<{ impact?: string; sentiment?: string; score?: number }>
        }
        if (p.items?.length) {
          const items = feedback.map((f, i) => {
            const item = p.items![i] ?? p.items![0]
            return {
              impact: item.impact ?? f.text.slice(0, 120),
              sentiment: item.sentiment ?? 'neutral',
              score: Number(item.score ?? 0.5),
            } satisfies Item
          })
          return {
            summary: p.summary ?? `Impact assessed for ${feedback.length} stakeholders`,
            items,
          }
        }
      }
    } catch { /* stub fallback */ }

    return {
      summary: `Stub impact assessment for ${feedback.length} stakeholders`,
      items: stubItems(),
    }
  }
}
