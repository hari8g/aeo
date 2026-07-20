import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import { NODE_KINDS, EDGE_KINDS } from '@avp/shared'

export interface OrganizationalLearningInput {
  verdictIds: number[]
  cycleId?: string
}

export interface OrganizationalLearningOutput {
  learningIds: number[]
  calibrationRecordIds: number[]
}

export const ORGANIZATIONAL_LEARNING_MANIFEST: AgentManifest = {
  id: 'organizational-learning:v1',
  name: 'Organizational Learning Agent',
  archetype: 'Knowledge Manager',
  domain: 'learn',
  runtime: 'worker',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [NODE_KINDS.LEARNING, NODE_KINDS.CALIBRATION_RECORD],
    edgeKinds: [EDGE_KINDS.DERIVED_FROM, EDGE_KINDS.UPDATES],
    requiresGate: false,
    maxWritesPerMinute: 60,
  },
  subscribes: ['context.learn.verdict_recorded', 'context.learn.impact_assessed'],
  healthEndpoint: 'http://localhost:7094/health',
  llmBudget: { maxTokensPerRun: 4000, preferredModel: 'claude-sonnet-4-6' },
}

export class OrganizationalLearningAgent extends BaseAgent {
  protected readonly agentId = 'organizational-learning:v1'
  protected readonly domain = 'learn' as const

  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) {
    super(adapter, llm)
  }

  async run(input: OrganizationalLearningInput): Promise<OrganizationalLearningOutput> {
    if (!input.verdictIds?.length) {
      this.fail('run', new Error('verdictIds required'))
    }

    const sessionId = randomUUID()
    const inputHash = this.hashInput(input)

    const rows = await this.adapter.graphRead<{ id: number; label: string; description: string | null }>(
      'SELECT id, label, description FROM graph_nodes WHERE id = ANY($1::int[])',
      [input.verdictIds],
    )

    const llm = await this.complete({
      model: 'claude-sonnet-4-6',
      maxTokens: 1500,
      messages: [{
        role: 'user',
        content: `Extract organizational lessons and calibration updates from these verdicts: ${JSON.stringify(rows)}.
Return JSON ONLY: {"learnings":[{"title":"...","body":"..."}],"calibrations":[{"title":"...","change":"..."}]}`,
      }],
    })

    const draft = this.parse(llm.text, rows)

    const learningIds: number[] = []
    for (const learning of draft.learnings) {
      const lid = await this.writeNode({
        kind: NODE_KINDS.LEARNING,
        label: learning.title,
        description: learning.body,
        metadata: { sourceVerdictIds: input.verdictIds },
        eventKind: 'lesson_captured',
        cycleId: input.cycleId,
      })
      learningIds.push(lid)
      for (const vid of input.verdictIds) {
        await this.writeEdge(lid, vid, EDGE_KINDS.DERIVED_FROM)
      }
    }

    const calibrationRecordIds: number[] = []
    for (const cal of draft.calibrations) {
      const cid = await this.writeNode({
        kind: NODE_KINDS.CALIBRATION_RECORD,
        label: cal.title,
        description: cal.change,
        metadata: { sourceVerdictIds: input.verdictIds },
        eventKind: 'calibration_updated',
        cycleId: input.cycleId,
      })
      calibrationRecordIds.push(cid)
      for (const lid of learningIds) {
        await this.writeEdge(cid, lid, EDGE_KINDS.UPDATES)
      }
    }

    await this.adapter.episodicMemory.write({
      agentId: this.agentId,
      sessionId,
      domain: 'learn',
      cycleId: input.cycleId,
      inputHash,
      inputSummary: `${input.verdictIds.length} verdicts`,
      outputSummary: `${learningIds.length} learnings, ${calibrationRecordIds.length} calibration records`,
      outputNodeIds: [...learningIds, ...calibrationRecordIds],
      confidencePct: 70,
      llmTokensUsed: llm.tokensUsed.output,
    })

    return { learningIds, calibrationRecordIds }
  }

  private parse(
    raw: string,
    rows: Array<{ id: number; label: string; description: string | null }>,
  ) {
    try {
      const s = raw.indexOf('{')
      const e = raw.lastIndexOf('}')
      if (s >= 0 && e > s) {
        const p = JSON.parse(raw.slice(s, e + 1)) as {
          learnings?: Array<{ title?: string; body?: string }>
          calibrations?: Array<{ title?: string; change?: string }>
        }
        const learnings = (p.learnings ?? [])
          .filter((l) => l.title)
          .map((l) => ({ title: l.title!, body: l.body ?? '' }))
        const calibrations = (p.calibrations ?? [])
          .filter((c) => c.title)
          .map((c) => ({ title: c.title!, change: c.change ?? '' }))
        if (learnings.length || calibrations.length) {
          return {
            learnings: learnings.length
              ? learnings
              : [{ title: 'Lesson captured', body: 'Derived from verdicts' }],
            calibrations: calibrations.length
              ? calibrations
              : [{ title: 'Calibration refresh', change: 'Incorporate latest verdicts' }],
          }
        }
      }
    } catch { /* stub fallback */ }

    const labels = rows.map((r) => r.label).join('; ') || 'verdicts'
    return {
      learnings: [{
        title: 'Lesson from cycle (stub)',
        body: `Stub lesson derived from: ${labels}`,
      }],
      calibrations: [{
        title: 'Calibration update (stub)',
        change: 'Update calibration based on latest verdicts',
      }],
    }
  }
}
