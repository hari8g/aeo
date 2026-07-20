import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import { NODE_KINDS, EDGE_KINDS } from '@avp/shared'

export interface SoftwareEngineeringInput {
  featureId: number
  files?: string[]
  note?: string
  cycleId?: string
}

export interface SoftwareEngineeringOutput {
  fileIds: number[]
  noteId: number
}

export const SOFTWARE_ENGINEERING_MANIFEST: AgentManifest = {
  id: 'software-engineering:v1',
  name: 'Software Engineering Agent',
  archetype: 'Software Engineer',
  domain: 'build',
  runtime: 'engineering',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [NODE_KINDS.CODE_FILE, NODE_KINDS.IMPLEMENTATION_NOTE],
    edgeKinds: [EDGE_KINDS.IMPLEMENTS, EDGE_KINDS.TOUCHES],
    requiresGate: false,
    maxWritesPerMinute: 60,
  },
  subscribes: ['context.define.architecture_proposed'],
  healthEndpoint: 'http://localhost:7111/health',
  llmBudget: { maxTokensPerRun: 3000, preferredModel: 'claude-sonnet-4-6' },
}

export class SoftwareEngineeringAgent extends BaseAgent {
  protected readonly agentId = 'software-engineering:v1'
  protected readonly domain = 'build' as const
  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) { super(adapter, llm) }

  async run(input: SoftwareEngineeringInput): Promise<SoftwareEngineeringOutput> {
    if (!input.featureId) this.fail('run', new Error('featureId required'))
    const sessionId = randomUUID()
    const inputHash = this.hashInput(input)

    const files = input.files?.length
      ? input.files
      : ['src/feature.ts', 'src/feature.test.ts']
    const noteText = input.note
      ?? `Stub implementation for feature ${input.featureId} (${files.length} files)`

    const llm = await this.complete({
      model: 'claude-sonnet-4-6',
      maxTokens: 800,
      messages: [{
        role: 'user',
        content: `Summarize this engineering changeset as a short title + risk note.
Feature: ${input.featureId}
Note: ${noteText}
Files: ${JSON.stringify(files)}
Return JSON ONLY: {"title":"...","risk":"low|medium|high"}`,
      }],
    })

    const meta = this.parse(llm.text, input.featureId)

    const noteId = await this.writeNode({
      kind: NODE_KINDS.IMPLEMENTATION_NOTE,
      label: meta.title.slice(0, 120),
      description: noteText,
      metadata: {
        featureId: input.featureId,
        files,
        risk: meta.risk,
      },
      eventKind: 'changeset_recorded',
      cycleId: input.cycleId,
      featureId: input.featureId,
    })
    await this.writeEdge(noteId, input.featureId, EDGE_KINDS.IMPLEMENTS)

    const fileIds: number[] = []
    for (const file of files) {
      const fid = await this.writeNode({
        kind: NODE_KINDS.CODE_FILE,
        label: file.slice(0, 120),
        description: `Code file: ${file}`,
        metadata: { path: file, noteId },
        eventKind: 'changeset_recorded',
        cycleId: input.cycleId,
        featureId: input.featureId,
      })
      fileIds.push(fid)
      await this.writeEdge(fid, input.featureId, EDGE_KINDS.IMPLEMENTS)
      await this.writeEdge(noteId, fid, EDGE_KINDS.TOUCHES)
    }

    await this.adapter.episodicMemory.write({
      agentId: this.agentId, sessionId, domain: 'build', cycleId: input.cycleId, inputHash,
      inputSummary: `feature=${input.featureId} files=${files.length}`,
      outputSummary: meta.title,
      outputNodeIds: [noteId, ...fileIds],
      confidencePct: 80, llmTokensUsed: llm.tokensUsed.output,
    })

    return { fileIds, noteId }
  }

  private parse(raw: string, featureId: number): { title: string; risk: string } {
    try {
      const s = raw.indexOf('{'); const e = raw.lastIndexOf('}')
      if (s >= 0 && e > s) {
        const p = JSON.parse(raw.slice(s, e + 1)) as { title?: string; risk?: string }
        return {
          title: p.title ?? `Implementation for feature ${featureId}`,
          risk: p.risk ?? 'low',
        }
      }
    } catch { /* fallback */ }
    return {
      title: `Implementation for feature ${featureId} (stub)`,
      risk: 'low',
    }
  }
}
