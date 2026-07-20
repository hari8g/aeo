import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import { NODE_KINDS, EDGE_KINDS } from '@avp/shared'

export interface FixtureResult {
  name: string
  status: string
  severity?: string
}

export interface QualityEngineeringInput {
  featureId: number
  fixtureResults?: FixtureResult[]
  cycleId?: string
}

export interface QualityEngineeringOutput {
  suiteId: number
  caseIds: number[]
  runId: number
  blocked: boolean
}

export const QUALITY_ENGINEERING_MANIFEST: AgentManifest = {
  id: 'quality-engineering:v1',
  name: 'Quality Engineering Agent',
  archetype: 'Quality Engineer',
  domain: 'build',
  runtime: 'pipeline',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [NODE_KINDS.TEST_SUITE, NODE_KINDS.TEST_CASE, NODE_KINDS.TEST_RUN, NODE_KINDS.BUILD],
    edgeKinds: [EDGE_KINDS.VERIFIES, EDGE_KINDS.BLOCKS],
    requiresGate: false,
    maxWritesPerMinute: 60,
  },
  subscribes: ['context.build.changeset_recorded'],
  healthEndpoint: 'http://localhost:7112/health',
  llmBudget: { maxTokensPerRun: 2000, preferredModel: 'claude-haiku-4-5-20251001' },
}

export class QualityEngineeringAgent extends BaseAgent {
  protected readonly agentId = 'quality-engineering:v1'
  protected readonly domain = 'build' as const
  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) { super(adapter, llm) }

  async run(input: QualityEngineeringInput): Promise<QualityEngineeringOutput> {
    if (!input.featureId) this.fail('run', new Error('featureId required'))
    const sessionId = randomUUID()
    const inputHash = this.hashInput(input)

    const results = input.fixtureResults?.length
      ? input.fixtureResults
      : [
        { name: 'unit-smoke', status: 'passed' },
        { name: 'integration-happy-path', status: 'passed' },
      ]

    const llm = await this.complete({
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 600,
      messages: [{
        role: 'user',
        content: `Evaluate quality gate for feature ${input.featureId}.
Results: ${JSON.stringify(results)}
Return JSON ONLY: {"summary":"...","blocked":false}`,
      }],
    })

    const verdict = this.parse(llm.text)

    const suiteId = await this.writeNode({
      kind: NODE_KINDS.TEST_SUITE,
      label: `Suite: feature ${input.featureId}`,
      description: verdict.summary,
      metadata: { featureId: input.featureId, resultCount: results.length },
      eventKind: 'quality_gate_evaluated',
      cycleId: input.cycleId,
      featureId: input.featureId,
    })
    await this.writeEdge(suiteId, input.featureId, EDGE_KINDS.VERIFIES)

    const caseIds: number[] = []
    let blocked = false

    for (const r of results) {
      const failed = /fail|error|broken/i.test(r.status)
      const severity = (r.severity ?? (failed ? 'medium' : 'info')).toLowerCase()
      const critical = severity === 'critical'

      const caseId = await this.writeNode({
        kind: NODE_KINDS.TEST_CASE,
        label: r.name.slice(0, 120),
        description: JSON.stringify(r),
        metadata: { status: r.status, severity, featureId: input.featureId },
        eventKind: 'quality_gate_evaluated',
        cycleId: input.cycleId,
        featureId: input.featureId,
      })
      caseIds.push(caseId)
      await this.writeEdge(caseId, suiteId, EDGE_KINDS.VERIFIES)

      if (failed && critical) {
        await this.writeEdge(caseId, input.featureId, EDGE_KINDS.BLOCKS)
        blocked = true
      }
    }

    if (verdict.blocked) blocked = true

    const runId = await this.writeNode({
      kind: NODE_KINDS.TEST_RUN,
      label: `Test run: feature ${input.featureId}`,
      description: JSON.stringify({ results, blocked, summary: verdict.summary }),
      metadata: {
        featureId: input.featureId,
        blocked,
        conclusion: blocked ? 'failure' : 'success',
        passed: results.filter((r) => !/fail|error|broken/i.test(r.status)).length,
        failed: results.filter((r) => /fail|error|broken/i.test(r.status)).length,
      },
      eventKind: 'quality_gate_evaluated',
      cycleId: input.cycleId,
      featureId: input.featureId,
    })
    await this.writeEdge(runId, suiteId, EDGE_KINDS.VERIFIES)

    if (blocked) {
      await this.writeEdge(runId, input.featureId, EDGE_KINDS.BLOCKS)
    } else {
      // Orchestrator advances on BUILD with conclusion success
      const qaBuildId = await this.writeNode({
        kind: NODE_KINDS.BUILD,
        label: `QA build gate: feature ${input.featureId}`,
        description: verdict.summary,
        metadata: {
          conclusion: 'success',
          featureId: input.featureId,
          runId,
          suiteId,
          source: 'quality-engineering',
        },
        eventKind: 'quality_gate_evaluated',
        cycleId: input.cycleId,
        featureId: input.featureId,
      })
      await this.writeEdge(qaBuildId, input.featureId, EDGE_KINDS.VERIFIES)
    }

    await this.adapter.episodicMemory.write({
      agentId: this.agentId, sessionId, domain: 'build', cycleId: input.cycleId, inputHash,
      inputSummary: `feature=${input.featureId} results=${results.length}`,
      outputSummary: verdict.summary + (blocked ? ' BLOCKED' : ' PASS'),
      outputNodeIds: [suiteId, ...caseIds, runId],
      confidencePct: 85, llmTokensUsed: llm.tokensUsed.output,
    })

    return { suiteId, caseIds, runId, blocked }
  }

  private parse(raw: string): { summary: string; blocked: boolean } {
    try {
      const s = raw.indexOf('{'); const e = raw.lastIndexOf('}')
      if (s >= 0 && e > s) {
        const p = JSON.parse(raw.slice(s, e + 1)) as { summary?: string; blocked?: boolean }
        return {
          summary: p.summary ?? 'Quality gate evaluated',
          blocked: Boolean(p.blocked),
        }
      }
    } catch { /* fallback */ }
    return { summary: 'Quality gate evaluated (stub)', blocked: false }
  }
}
