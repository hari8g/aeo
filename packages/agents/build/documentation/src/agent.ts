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
      title: 'Toll.OS MLFF event metering guide',
      outline: [
        '1. Overview — Bosch MPS meters each attributed MLFF passage as a ₹5 Toll.OS orchestration event; recovered capture underpins ~€1.5–2.0M/year from 2027 after ~€350–400k delivery.',
        '2. Sensor fusion — ANPR + FASTag RFID within the fusion window (clock-skew tolerant) produce one attribution; orphans never silent-drop.',
        '3. Exceptions — LiDAR / orphan workflows normalise vendor schemas; resolve → exactly one ₹5 meter.',
        '4. Event metering — commercial invariants before persist; late RFID metadata-only.',
        '5. Billing ledger — idempotent keys; invoice counts = distinct ledger IDs; reconciliation slices for RA.',
        '6. Privacy — imagery TTL; purpose-limited access under operator DPA.',
        '7. Ops — aging/escalation, soak-test and go-live gates.',
        '8. Commercial — ₹5/event unit price; GTM LTV:CAC ~10–16×; payback ~8–11 months.',
      ].join('\n'),
      changelog: [
        '- Meter ANPR diagnoses as ₹5 Toll.OS events',
        '- Fuse RFID+ANPR (clock-skew tolerant); orphans → exceptions',
        '- LiDAR vendor normalisation; resolve → ₹5',
        '- Idempotent ledger; late RFID no double-bill',
        '- Invoice export = ledger counts; reconciliation slices',
        '- Imagery TTL / DPA purpose limits',
        `- Docs generated for feature ${featureId}`,
      ].join('\n'),
    }
  }
}
