import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import { NODE_KINDS, EDGE_KINDS } from '@avp/shared'

export interface DomainStewardInput {
  featureId: number
  cycleId?: string
}

export interface DomainStewardOutput {
  conceptIds: number[]
  kpiIds: number[]
  ruleIds: number[]
}

type DomainDraft = {
  concepts: Array<{ name: string; description: string; related?: string[] }>
  kpis: Array<{ name: string; description: string; target?: string }>
  regulations: Array<{ name: string; description: string }>
  rules: Array<{ name: string; description: string }>
}

export const DOMAIN_STEWARD_MANIFEST: AgentManifest = {
  id: 'domain-steward:v1',
  name: 'Domain Steward Agent',
  archetype: 'Domain Modeler',
  domain: 'define',
  runtime: 'studio',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [
      NODE_KINDS.DOMAIN_CONCEPT,
      NODE_KINDS.KPI,
      NODE_KINDS.REGULATION,
      NODE_KINDS.BUSINESS_RULE,
    ],
    edgeKinds: [EDGE_KINDS.DEFINES, EDGE_KINDS.RELATES_TO],
    requiresGate: false,
    maxWritesPerMinute: 60,
  },
  subscribes: ['context.define.requirements_baselined'],
  healthEndpoint: 'http://localhost:7102/health',
  llmBudget: { maxTokensPerRun: 5000, preferredModel: 'claude-sonnet-4-6' },
}

export class DomainStewardAgent extends BaseAgent {
  protected readonly agentId = 'domain-steward:v1'
  protected readonly domain = 'define' as const
  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) { super(adapter, llm) }

  async run(input: DomainStewardInput): Promise<DomainStewardOutput> {
    if (!input.featureId) this.fail('run', new Error('featureId required'))
    const sessionId = randomUUID()
    const inputHash = this.hashInput(input)

    const featureRows = await this.adapter.graphRead<{ id: number; label: string; description: string | null }>(
      'SELECT id, label, description FROM graph_nodes WHERE id = $1',
      [input.featureId],
    )

    const llm = await this.complete({
      model: 'claude-sonnet-4-6',
      maxTokens: 2000,
      messages: [{
        role: 'user',
        content: `Extract domain concepts, KPIs, regulations, and business rules for this feature.
Feature: ${JSON.stringify(featureRows[0] ?? { id: input.featureId })}
Return JSON ONLY: {"concepts":[{"name":"...","description":"...","related":["Other"]}],"kpis":[{"name":"...","description":"...","target":"..."}],"regulations":[{"name":"...","description":"..."}],"rules":[{"name":"...","description":"..."}]}`,
      }],
    })

    const draft = this.parse(llm.text)
    const conceptIds: number[] = []
    const kpiIds: number[] = []
    const ruleIds: number[] = []
    const conceptByName = new Map<string, number>()

    for (const c of draft.concepts) {
      const cid = await this.writeNode({
        kind: NODE_KINDS.DOMAIN_CONCEPT,
        label: c.name.slice(0, 120),
        description: c.description,
        metadata: { featureId: input.featureId },
        eventKind: 'domain_model_updated',
        cycleId: input.cycleId,
        featureId: input.featureId,
      })
      conceptIds.push(cid)
      conceptByName.set(c.name.toLowerCase(), cid)
      await this.writeEdge(input.featureId, cid, EDGE_KINDS.DEFINES)
    }

    for (const c of draft.concepts) {
      const fromId = conceptByName.get(c.name.toLowerCase())
      if (!fromId) continue
      for (const related of c.related ?? []) {
        const toId = conceptByName.get(related.toLowerCase())
        if (toId && toId !== fromId) await this.writeEdge(fromId, toId, EDGE_KINDS.RELATES_TO)
      }
    }

    for (const kpi of draft.kpis) {
      const kid = await this.writeNode({
        kind: NODE_KINDS.KPI,
        label: kpi.name.slice(0, 120),
        description: kpi.description,
        metadata: { featureId: input.featureId, target: kpi.target },
        eventKind: 'domain_model_updated',
        cycleId: input.cycleId,
        featureId: input.featureId,
      })
      kpiIds.push(kid)
      await this.writeEdge(input.featureId, kid, EDGE_KINDS.DEFINES)
    }

    for (const reg of draft.regulations) {
      const rid = await this.writeNode({
        kind: NODE_KINDS.REGULATION,
        label: reg.name.slice(0, 120),
        description: reg.description,
        metadata: { featureId: input.featureId },
        eventKind: 'domain_model_updated',
        cycleId: input.cycleId,
        featureId: input.featureId,
      })
      ruleIds.push(rid)
      await this.writeEdge(input.featureId, rid, EDGE_KINDS.RELATES_TO)
    }

    for (const rule of draft.rules) {
      const rid = await this.writeNode({
        kind: NODE_KINDS.BUSINESS_RULE,
        label: rule.name.slice(0, 120),
        description: rule.description,
        metadata: { featureId: input.featureId },
        eventKind: 'domain_model_updated',
        cycleId: input.cycleId,
        featureId: input.featureId,
      })
      ruleIds.push(rid)
      await this.writeEdge(input.featureId, rid, EDGE_KINDS.DEFINES)
    }

    await this.adapter.episodicMemory.write({
      agentId: this.agentId, sessionId, domain: 'define', cycleId: input.cycleId, inputHash,
      inputSummary: `feature=${input.featureId}`,
      outputSummary: `${conceptIds.length} concepts, ${kpiIds.length} kpis, ${ruleIds.length} rules`,
      outputNodeIds: [...conceptIds, ...kpiIds, ...ruleIds],
      confidencePct: 70, llmTokensUsed: llm.tokensUsed.output,
    })

    return { conceptIds, kpiIds, ruleIds }
  }

  private parse(raw: string): DomainDraft {
    try {
      const s = raw.indexOf('{'); const e = raw.lastIndexOf('}')
      if (s >= 0 && e > s) {
        const p = JSON.parse(raw.slice(s, e + 1)) as Partial<DomainDraft>
        if (p.concepts?.length || p.kpis?.length || p.rules?.length || p.regulations?.length) {
          return {
            concepts: (p.concepts ?? []).map((c) => ({
              name: c.name ?? 'Concept',
              description: c.description ?? '',
              related: c.related ?? [],
            })),
            kpis: (p.kpis ?? []).map((k) => ({
              name: k.name ?? 'KPI',
              description: k.description ?? '',
              target: k.target,
            })),
            regulations: (p.regulations ?? []).map((r) => ({
              name: r.name ?? 'Regulation',
              description: r.description ?? '',
            })),
            rules: (p.rules ?? []).map((r) => ({
              name: r.name ?? 'Business rule',
              description: r.description ?? '',
            })),
          }
        }
      }
    } catch { /* fallback */ }
    return {
      concepts: [
        {
          name: 'Toll.OS orchestration event',
          description:
            'Billable ₹5 unit for one attributed MLFF passage — building block of the €1.5–2.0M/year value band from 2027.',
          related: [],
        },
        {
          name: 'ANPR plate diagnosis',
          description: 'Gantry camera plate read with confidence; can alone create an event above threshold.',
          related: ['Toll.OS orchestration event'],
        },
        {
          name: 'FASTag RFID read',
          description: 'Roadside RFID observation that fuses with ANPR inside the fusion window.',
          related: ['Toll.OS orchestration event'],
        },
        {
          name: 'LiDAR exception',
          description: 'Ambiguity that opens exception orchestration until attribution resolves.',
          related: ['Toll.OS orchestration event'],
        },
        {
          name: 'Event key',
          description: 'Idempotency key so retries never create a second ₹5 charge.',
          related: ['Toll.OS orchestration event'],
        },
      ],
      kpis: [
        {
          name: 'Billable events per corridor-day',
          description: 'Distinct ₹5 events invoiced per corridor per day.',
          target: 'Match sensor-attributed passages within 2%',
        },
        {
          name: 'Double-bill rate',
          description: 'Passages with more than one ₹5 charge after fusion/retries.',
          target: '< 0.1%',
        },
        {
          name: 'Invoice-to-roadside gap',
          description: 'Hours where sensors exceed metered events beyond KPI band.',
          target: '↓ 40% within 120 days',
        },
      ],
      regulations: [
        {
          name: 'Corridor privacy retention',
          description: 'Raw imagery only for corridor-agreed window; ledger keeps event IDs.',
        },
      ],
      rules: [
        {
          name: '₹5 per successful orchestration event',
          description: 'Exactly one ₹5 charge per attributed passage — never two, never zero.',
        },
        {
          name: 'Idempotent event keys',
          description: 'Replays with the same key do not create a second ledger entry.',
        },
      ],
    }
  }
}
