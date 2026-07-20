import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import { NODE_KINDS, EDGE_KINDS } from '@avp/shared'

export interface SolutionsArchitectInput {
  featureId: number
  storyIds?: number[]
  cycleId?: string
}

export interface SolutionsArchitectOutput {
  contextIds: number[]
  interfaceIds: number[]
}

type ArchDraft = {
  contexts: Array<{ name: string; description: string; dependsOn?: string[] }>
  interfaces: Array<{ name: string; protocol: string; context: string; dependsOn?: string[] }>
}

export const SOLUTIONS_ARCHITECT_MANIFEST: AgentManifest = {
  id: 'solutions-architect:v1',
  name: 'Solutions Architect Agent',
  archetype: 'Solutions Architect',
  domain: 'define',
  runtime: 'engineering',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [NODE_KINDS.BOUNDED_CONTEXT, NODE_KINDS.SERVICE_INTERFACE],
    edgeKinds: [EDGE_KINDS.IMPLEMENTS, EDGE_KINDS.DEPENDS_ON],
    requiresGate: false,
    maxWritesPerMinute: 60,
  },
  subscribes: ['context.define.requirements_baselined'],
  healthEndpoint: 'http://localhost:7103/health',
  llmBudget: { maxTokensPerRun: 6000, preferredModel: 'claude-sonnet-4-6' },
}

export class SolutionsArchitectAgent extends BaseAgent {
  protected readonly agentId = 'solutions-architect:v1'
  protected readonly domain = 'define' as const
  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) { super(adapter, llm) }

  async run(input: SolutionsArchitectInput): Promise<SolutionsArchitectOutput> {
    if (!input.featureId) this.fail('run', new Error('featureId required'))
    const sessionId = randomUUID()
    const inputHash = this.hashInput(input)

    const stories = input.storyIds?.length
      ? await this.adapter.graphRead<{ id: number; label: string; description: string | null }>(
        'SELECT id, label, description FROM graph_nodes WHERE id = ANY($1::int[])',
        [input.storyIds],
      )
      : []

    const llm = await this.complete({
      model: 'claude-sonnet-4-6',
      maxTokens: 2500,
      messages: [{
        role: 'user',
        content: `Propose bounded contexts and service interfaces for feature ${input.featureId}.
Stories: ${JSON.stringify(stories)}
Return JSON ONLY: {"contexts":[{"name":"...","description":"...","dependsOn":["Other"]}],"interfaces":[{"name":"...","protocol":"HTTP","context":"...","dependsOn":["OtherIface"]}]}`,
      }],
    })

    const draft = this.parse(llm.text)
    const contextIds: number[] = []
    const contextByName = new Map<string, number>()

    for (const ctx of draft.contexts) {
      const cid = await this.writeNode({
        kind: NODE_KINDS.BOUNDED_CONTEXT,
        label: ctx.name.slice(0, 120),
        description: ctx.description,
        metadata: { featureId: input.featureId, storyIds: input.storyIds ?? [] },
        eventKind: 'architecture_proposed',
        cycleId: input.cycleId,
        featureId: input.featureId,
      })
      contextIds.push(cid)
      contextByName.set(ctx.name.toLowerCase(), cid)
      await this.writeEdge(cid, input.featureId, EDGE_KINDS.IMPLEMENTS)
    }

    for (const ctx of draft.contexts) {
      const fromId = contextByName.get(ctx.name.toLowerCase())
      if (!fromId) continue
      for (const dep of ctx.dependsOn ?? []) {
        const toId = contextByName.get(dep.toLowerCase())
        if (toId && toId !== fromId) await this.writeEdge(fromId, toId, EDGE_KINDS.DEPENDS_ON)
      }
    }

    for (const storyId of input.storyIds ?? []) {
      for (const cid of contextIds) {
        await this.writeEdge(cid, storyId, EDGE_KINDS.IMPLEMENTS)
      }
    }

    const interfaceIds: number[] = []
    const ifaceByName = new Map<string, number>()
    for (const iface of draft.interfaces) {
      const iid = await this.writeNode({
        kind: NODE_KINDS.SERVICE_INTERFACE,
        label: iface.name.slice(0, 120),
        description: `${iface.protocol} — ${iface.context}`,
        metadata: { protocol: iface.protocol, context: iface.context, featureId: input.featureId },
        eventKind: 'architecture_proposed',
        cycleId: input.cycleId,
        featureId: input.featureId,
      })
      interfaceIds.push(iid)
      ifaceByName.set(iface.name.toLowerCase(), iid)
      const ctxId = contextByName.get(iface.context.toLowerCase())
      if (ctxId) await this.writeEdge(iid, ctxId, EDGE_KINDS.IMPLEMENTS)
      else await this.writeEdge(iid, input.featureId, EDGE_KINDS.IMPLEMENTS)
    }

    for (const iface of draft.interfaces) {
      const fromId = ifaceByName.get(iface.name.toLowerCase())
      if (!fromId) continue
      for (const dep of iface.dependsOn ?? []) {
        const toId = ifaceByName.get(dep.toLowerCase())
        if (toId && toId !== fromId) await this.writeEdge(fromId, toId, EDGE_KINDS.DEPENDS_ON)
      }
    }

    await this.adapter.episodicMemory.write({
      agentId: this.agentId, sessionId, domain: 'define', cycleId: input.cycleId, inputHash,
      inputSummary: `feature=${input.featureId} stories=${input.storyIds?.length ?? 0}`,
      outputSummary: `${contextIds.length} contexts, ${interfaceIds.length} interfaces`,
      outputNodeIds: [...contextIds, ...interfaceIds],
      confidencePct: 72, llmTokensUsed: llm.tokensUsed.output,
    })

    return { contextIds, interfaceIds }
  }

  private parse(raw: string): ArchDraft {
    try {
      const s = raw.indexOf('{'); const e = raw.lastIndexOf('}')
      if (s >= 0 && e > s) {
        const p = JSON.parse(raw.slice(s, e + 1)) as Partial<ArchDraft>
        return {
          contexts: p.contexts?.length
            ? p.contexts.map((c) => ({
              name: c.name ?? 'Context',
              description: c.description ?? '',
              dependsOn: c.dependsOn ?? [],
            }))
            : [{ name: 'Feature Context', description: 'Primary bounded context', dependsOn: [] }],
          interfaces: p.interfaces?.length
            ? p.interfaces.map((i) => ({
              name: i.name ?? 'API',
              protocol: i.protocol ?? 'HTTP',
              context: i.context ?? p.contexts?.[0]?.name ?? 'Feature Context',
              dependsOn: i.dependsOn ?? [],
            }))
            : [{ name: 'REST API', protocol: 'HTTP', context: 'Feature Context', dependsOn: [] }],
        }
      }
    } catch { /* fallback */ }
    return {
      contexts: [
        { name: 'API Context', description: 'HTTP entrypoint context', dependsOn: ['Domain Context'] },
        { name: 'Domain Context', description: 'Business logic context', dependsOn: [] },
      ],
      interfaces: [
        { name: 'REST API', protocol: 'HTTP', context: 'API Context', dependsOn: ['Domain Service'] },
        { name: 'Domain Service', protocol: 'internal', context: 'Domain Context', dependsOn: [] },
      ],
    }
  }
}
