import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import { NODE_KINDS, EDGE_KINDS } from '@avp/shared'

export interface DocumentationInput {
  featureId: number
  cycleId?: string
}

export interface DocumentationOutput {
  documentationId: number
  changelogId: number
}

type DocsDraft = {
  title: string
  outline: string
  changelog: string
}

export const DOCUMENTATION_MANIFEST: AgentManifest = {
  id: 'documentation:v1',
  name: 'Documentation Agent',
  archetype: 'Technical Writer',
  domain: 'build',
  runtime: 'engineering',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [NODE_KINDS.DOCUMENTATION, NODE_KINDS.CHANGELOG],
    edgeKinds: [EDGE_KINDS.DOCUMENTS],
    requiresGate: false,
    maxWritesPerMinute: 40,
  },
  subscribes: ['context.build.changeset_recorded'],
  healthEndpoint: 'http://localhost:7113/health',
  llmBudget: { maxTokensPerRun: 4000, preferredModel: 'claude-sonnet-4-6' },
}

export class DocumentationAgent extends BaseAgent {
  protected readonly agentId = 'documentation:v1'
  protected readonly domain = 'build' as const
  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) { super(adapter, llm) }

  async run(input: DocumentationInput): Promise<DocumentationOutput> {
    if (!input.featureId) this.fail('run', new Error('featureId required'))
    const sessionId = randomUUID()
    const inputHash = this.hashInput(input)

    const featureRows = await this.adapter.graphRead<{ id: number; label: string; description: string | null }>(
      'SELECT id, label, description FROM graph_nodes WHERE id = $1',
      [input.featureId],
    )

    const llm = await this.complete({
      model: 'claude-sonnet-4-6',
      maxTokens: 1500,
      messages: [{
        role: 'user',
        content: `Draft product documentation outline and changelog entry.
Feature: ${JSON.stringify(featureRows[0] ?? { id: input.featureId })}
Return JSON ONLY: {"title":"...","outline":"...","changelog":"..."}`,
      }],
    })

    const draft = this.parse(llm.text, input.featureId)

    const documentationId = await this.writeNode({
      kind: NODE_KINDS.DOCUMENTATION,
      label: draft.title.slice(0, 120),
      description: draft.outline,
      metadata: { featureId: input.featureId },
      eventKind: 'docs_drafted',
      cycleId: input.cycleId,
      featureId: input.featureId,
    })
    await this.writeEdge(documentationId, input.featureId, EDGE_KINDS.DOCUMENTS)

    const changelogId = await this.writeNode({
      kind: NODE_KINDS.CHANGELOG,
      label: `Changelog: feature ${input.featureId}`,
      description: draft.changelog,
      metadata: { documentationId, featureId: input.featureId },
      eventKind: 'docs_drafted',
      cycleId: input.cycleId,
      featureId: input.featureId,
    })
    await this.writeEdge(changelogId, input.featureId, EDGE_KINDS.DOCUMENTS)
    await this.writeEdge(changelogId, documentationId, EDGE_KINDS.DOCUMENTS)

    await this.adapter.episodicMemory.write({
      agentId: this.agentId, sessionId, domain: 'build', cycleId: input.cycleId, inputHash,
      inputSummary: `feature=${input.featureId}`,
      outputSummary: draft.title,
      outputNodeIds: [documentationId, changelogId],
      confidencePct: 70, llmTokensUsed: llm.tokensUsed.output,
    })

    return { documentationId, changelogId }
  }

  private parse(raw: string, featureId: number): DocsDraft {
    try {
      const s = raw.indexOf('{'); const e = raw.lastIndexOf('}')
      if (s >= 0 && e > s) {
        const p = JSON.parse(raw.slice(s, e + 1)) as Partial<DocsDraft>
        return {
          title: p.title ?? `Docs for feature ${featureId}`,
          outline: p.outline ?? 'Overview, usage, limits',
          changelog: p.changelog ?? `- Added feature ${featureId}`,
        }
      }
    } catch { /* fallback */ }
    return {
      title: `Documentation (stub) — feature ${featureId}`,
      outline: 'Stub documentation outline pending LLM',
      changelog: `- Added feature ${featureId} (stub)`,
    }
  }
}
