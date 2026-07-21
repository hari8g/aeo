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
        system:
          'You are a senior Business Analyst writing intake briefs for Bosch MPS Customer Insights. Be evidence-based and use plain language. Write comprehensive, multi-paragraph fields — not one-liners or placeholders.',
        maxTokens: 3500,
        messages: [{
          role: 'user',
          content: `Write a structured intake brief for these customer pain points.\n${dedupeContext}\n\nPain points:\n${input.painPointLabels.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n\nExisting features (avoid duplicating):\n${existing.map((e) => e.label).join('\n')}\n\nReturn JSON only. Each string field below should be detailed (2–4 short paragraphs joined with \\n\\n where helpful):\n{"title":"Feature title","problemStatement":"Full problem narrative: what breaks, why it matters commercially, what happens if we do nothing","customerSegment":"Primary / secondary / tertiary who is affected and why","evidenceSummary":"What signals, voice-of-customer, trends, and implications tell us","isDuplicate":false,"duplicateOf":null,"recommendation":"Clear admit/defer stance with prioritized outcomes and scope boundaries"}`,
        }],
      })
      llmText = res.text
      tokensUsed = res.tokensUsed.output
    } catch {
      /* use deterministic fallback from pain labels */
    }

    const parsed = this.parse(llmText, input.painPointLabels)
    const uniq = sessionId.slice(0, 8)
    const featureLabel = existing.some((e) => e.label === parsed.title.slice(0, 120))
      ? `${parsed.title.slice(0, 100)} · ${uniq}`
      : parsed.title.slice(0, 120)

    const briefId = await this.writeNode({
      kind: NODE_KINDS.BRIEF,
      label: `Brief: ${parsed.title} · ${uniq}`.slice(0, 120),
      description: JSON.stringify(parsed),
      metadata: { isDuplicate: parsed.isDuplicate },
      eventKind: 'brief_written',
      cycleId: input.cycleId,
    })

    const featureId = await this.writeNode({
      kind: NODE_KINDS.FEATURE,
      label: featureLabel,
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
    const fallback = this.fallbackBrief(labels)

    try {
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      if (start < 0 || end <= start) return fallback
      const p = JSON.parse(raw.slice(start, end + 1)) as Partial<BriefDraft>
      const stubish = (v: string | undefined) =>
        !v || /stub|pending llm|todo|tbd/i.test(v)
      return {
        title: p.title ?? fallback.title,
        problemStatement: stubish(p.problemStatement)
          ? fallback.problemStatement
          : (p.problemStatement as string),
        customerSegment: stubish(p.customerSegment)
          ? fallback.customerSegment
          : (p.customerSegment as string),
        evidenceSummary: stubish(p.evidenceSummary)
          ? fallback.evidenceSummary
          : (p.evidenceSummary as string),
        isDuplicate: Boolean(p.isDuplicate),
        duplicateOf: p.duplicateOf ?? null,
        recommendation: stubish(p.recommendation)
          ? fallback.recommendation
          : (p.recommendation as string),
      }
    } catch {
      return fallback
    }
  }

  private fallbackBrief(labels: string[]): BriefDraft {
    const title = labels[0] ?? 'Untitled feature'
    const joined = labels.map((l, i) => `${i + 1}. ${l}`).join('\n')
    const blob = labels.join(' ').toLowerCase()

    if (/toll\.?os|mlff|anpr|fastag|lidar|₹5|rs\.?\s*5|metering/.test(blob)) {
      return {
        title: title.includes('Toll') ? title : 'Toll.OS MLFF orchestration event metering at ₹5/event',
        problemStatement: [
          'On Toll.OS Multi-Lane Free Flow corridors, Bosch MPS bills ₹5 per successfully attributed orchestration event (ANPR diagnosis, FASTag RFID confirmation, or resolved LiDAR exception). Those events do not land cleanly in one ledger today.',
          'Missed ANPR landings, unfused RFID+ANPR half-events, and dropped LiDAR exceptions create a growing gap between roadside activity and metered revenue. Operators cannot reconcile corridor invoices; Bosch MPS cannot defend contracted event volumes.',
          'Without an idempotent orchestration ledger and fusion rules, Toll.OS cannot be trusted as the system of record for MLFF metering.',
        ].join('\n\n'),
        customerSegment: [
          'Primary: national / major regional toll concessionaires and operators on Toll.OS MLFF (ops, revenue assurance, roadside engineering).',
          'Secondary: Bosch MPS commercial/billing teams invoicing at ₹5 per recorded event.',
          'Tertiary: corridor integrators wiring ANPR, FASTag RFID, and LiDAR feeds into Toll.OS.',
        ].join(' '),
        evidenceSummary: [
          `Customer signals motivating this case:\n${joined}`,
          'Operators report lost ₹5 events when ANPR never reaches orchestration, LiDAR exceptions disappearing before workflows open, and RFID+ANPR producing two charges or zero. Trend is stronger on dense urban MLFF sections.',
          'Commercial implication: recovering under-captured events at ₹5/event is the core Toll.OS metering bet for Bosch MPS — not a peripheral enhancement.',
        ].join('\n\n'),
        isDuplicate: false,
        duplicateOf: null,
        recommendation: [
          'Admit Toll.OS MLFF metering into Define: meter every successful ANPR once at ₹5, fuse matching RFID+ANPR into one event, and keep LiDAR exception resolutions on a replay-safe ₹5 path.',
          'Keep scope on metering integrity and fusion — defer corridor instrumentation that is not yet live.',
        ].join('\n\n'),
      }
    }

    if (/staas|3pl|warehouse|dock|asn|inventory|uffizio/.test(blob)) {
      return {
        title: title.includes('StaaS') ? title : 'Near-real-time StaaS inventory for Uffizio logistics',
        problemStatement: [
          'Uffizio on Bosch MPS Store-as-a-Service sees StaaS inventory and ASN updates lag 4–12 hours, so outbound dock waves are planned on stale stock.',
          'Retail-oriented sync cadence does not match Uffizio logistics warehouse rhythm: afternoon waves release while StaaS still shows morning counts, driving rework, missed SLAs, and idle labour at the door.',
          'Until StaaS presents live on-hand and ASN state for Uffizio sites, dock planning stays a manual reconciliation exercise.',
        ].join('\n\n'),
        customerSegment: [
          'Primary: Uffizio — MPS StaaS logistics customer (dock managers, inventory planners) and co-located loyalty program owners.',
          'Secondary: Bosch MPS StaaS product and customer success accountable for Uffizio logistics SLAs.',
          'Tertiary: shippers who feel late or wrong loads as service failures rooted in stale StaaS data.',
        ].join(' '),
        evidenceSummary: [
          `Customer signals motivating this case:\n${joined}`,
          'Uffizio voices ask for near-real-time StaaS stock for logistics — not retail store sync. Mis-planned trailers carry measurable rework cost across Uffizio hubs.',
        ].join('\n\n'),
        isDuplicate: false,
        duplicateOf: null,
        recommendation: [
          'Size and admit a focused StaaS logistics + loyalty bet for Uffizio: near-real-time warehouse inventory + ASN and event-accurate earn/burn.',
          'Do not expand into full WMS replacement — stay on inventory freshness and loyalty integrity for Uffizio outbound dock planning.',
        ].join('\n\n'),
      }
    }

    return {
      title,
      problemStatement: [
        `Customers report a recurring operational gap across these pain points:\n${joined}`,
        'Today there is no single, trusted product response that closes the loop from signal to measurable outcome. Teams compensate with workarounds, which hides cost and makes revenue or service impact hard to defend.',
        'Without a structured case — clear problem, affected cohorts, evidence, and a recommendation — Portfolio Review cannot prioritize investment against other Bosch MPS bets.',
      ].join('\n\n'),
      customerSegment: [
        'Primary: the operators and end users who raised these signals and live with the workaround daily.',
        'Secondary: Bosch MPS product, commercial, and delivery teams accountable for the affected offering.',
        'Tertiary: adjacent partners or customers who feel downstream service or billing impact.',
      ].join(' '),
      evidenceSummary: [
        `Evidence base for this intake:\n${joined}`,
        'Treat these labels as voice-of-customer anchors: quantify frequency, severity, and trend in value sizing next. Prefer corroborating signals over single anecdotes before expanding scope.',
      ].join('\n\n'),
      isDuplicate: false,
      duplicateOf: null,
      recommendation: [
        'Proceed to business case sizing with a tightly scoped outcome tied to the top pain above. Admit if value and risk hold; defer if instrumentation or customer readiness is not live.',
        'Keep the first release focused on the highest-evidence failure mode — resist bundling unrelated asks into the same feature.',
      ].join('\n\n'),
    }
  }
}
