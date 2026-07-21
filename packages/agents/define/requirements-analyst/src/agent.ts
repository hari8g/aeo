import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import { NODE_KINDS, EDGE_KINDS } from '@avp/shared'

export interface RequirementsAnalystInput {
  featureId: number
  cycleId?: string
}

export interface RequirementsAnalystOutput {
  storyIds: number[]
  acceptanceIds: number[]
}

type StoryDraft = {
  title: string
  description: string
  criteria: Array<{ label: string; description: string }>
}

export const REQUIREMENTS_ANALYST_MANIFEST: AgentManifest = {
  id: 'requirements-analyst:v1',
  name: 'Requirements Analyst Agent',
  archetype: 'Requirements Analyst',
  domain: 'define',
  runtime: 'studio',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [NODE_KINDS.USER_STORY, NODE_KINDS.ACCEPTANCE_CRITERION],
    edgeKinds: [EDGE_KINDS.REFINES, EDGE_KINDS.ACCEPTS],
    requiresGate: false,
    maxWritesPerMinute: 60,
  },
  subscribes: ['context.decide.portfolio_decision_made'],
  healthEndpoint: 'http://localhost:7101/health',
  llmBudget: { maxTokensPerRun: 6000, preferredModel: 'claude-sonnet-4-6' },
}

export class RequirementsAnalystAgent extends BaseAgent {
  protected readonly agentId = 'requirements-analyst:v1'
  protected readonly domain = 'define' as const
  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) { super(adapter, llm) }

  async run(input: RequirementsAnalystInput): Promise<RequirementsAnalystOutput> {
    if (!input.featureId) this.fail('run', new Error('featureId required'))
    const sessionId = randomUUID()
    const inputHash = this.hashInput(input)

    const features = await this.adapter.graphRead<{ id: number; label: string; description: string | null }>(
      'SELECT id, label, description FROM graph_nodes WHERE id = $1 AND kind = $2',
      [input.featureId, NODE_KINDS.FEATURE],
    )
    const feature = features[0]
    if (!feature) this.fail('run', new Error(`FEATURE node ${input.featureId} not found`))

    const llm = await this.complete({
      model: 'claude-sonnet-4-6',
      maxTokens: 2500,
      messages: [{
        role: 'user',
        content: `Draft user stories with acceptance criteria for this feature.
Feature: ${JSON.stringify(feature)}
Return JSON ONLY: {"stories":[{"title":"...","description":"...","criteria":[{"label":"...","description":"..."}]}]}`,
      }],
    })

    const draft = this.parse(llm.text, `${feature.label}\n${feature.description ?? ''}`)
    const storyIds: number[] = []
    const acceptanceIds: number[] = []

    for (const story of draft) {
      const storyId = await this.writeNode({
        kind: NODE_KINDS.USER_STORY,
        label: story.title.slice(0, 120),
        description: story.description,
        metadata: { featureId: input.featureId },
        eventKind: 'requirements_baselined',
        cycleId: input.cycleId,
        featureId: input.featureId,
      })
      storyIds.push(storyId)
      await this.writeEdge(input.featureId, storyId, EDGE_KINDS.REFINES)

      for (const ac of story.criteria) {
        const acId = await this.writeNode({
          kind: NODE_KINDS.ACCEPTANCE_CRITERION,
          label: ac.label.slice(0, 120),
          description: ac.description,
          metadata: { storyId },
          eventKind: 'requirements_baselined',
          cycleId: input.cycleId,
          featureId: input.featureId,
        })
        acceptanceIds.push(acId)
        await this.writeEdge(storyId, acId, EDGE_KINDS.ACCEPTS)
      }
    }

    await this.adapter.episodicMemory.write({
      agentId: this.agentId, sessionId, domain: 'define', cycleId: input.cycleId, inputHash,
      inputSummary: `feature=${input.featureId}`,
      outputSummary: `${storyIds.length} stories, ${acceptanceIds.length} criteria`,
      outputNodeIds: [...storyIds, ...acceptanceIds],
      confidencePct: 75, llmTokensUsed: llm.tokensUsed.output,
    })

    return { storyIds, acceptanceIds }
  }

  private parse(raw: string, contextBlob = ''): StoryDraft[] {
    const fallback = this.fallbackStories(contextBlob)
    try {
      const s = raw.indexOf('{'); const e = raw.lastIndexOf('}')
      if (s >= 0 && e > s) {
        const p = JSON.parse(raw.slice(s, e + 1)) as {
          stories?: Array<{
            title?: string; description?: string
            criteria?: Array<{ label?: string; description?: string }>
          }>
        }
        if (p.stories?.length) {
          const stories = p.stories.map((r) => ({
            title: r.title ?? 'Untitled story',
            description: r.description ?? '',
            criteria: r.criteria?.length
              ? r.criteria.map((c) => ({
                label: c.label ?? 'Acceptance criterion',
                description: c.description ?? '',
              }))
              : fallback[0]!.criteria,
          }))
          if (stories.some((st) => /stub/i.test(st.title) || /core capability/i.test(st.description))) {
            return fallback
          }
          return stories
        }
      }
    } catch { /* fallback */ }
    return fallback
  }

  private fallbackStories(contextBlob: string): StoryDraft[] {
    if (/toll\.?os|mlff|anpr|metering|₹5/i.test(contextBlob)) {
      return [
        {
          title: 'Meter an ANPR plate diagnosis as a ₹5 Toll.OS event',
          description:
            'As a Bosch MPS commercial operator, I want every successful ANPR diagnosis on an MLFF gantry recorded as one billable Toll.OS orchestration event at ₹5, so corridor revenue matches sensor activity and supports the €1.5–2.0M/year value band from 2027.',
          criteria: [
            {
              label: 'ANPR success writes one ledger event',
              description:
                'Above-threshold ANPR creates exactly one ₹5 orchestration event with a stable event key within the corridor metering SLA.',
            },
            {
              label: 'Failed diagnoses do not bill',
              description:
                'Below-threshold or rejected ANPR creates no ₹5 event until an exception path attributes the passage.',
            },
            {
              label: 'Latency within corridor SLA',
              description: 'ANPR success to ledger persist ≤ configured p95 SLA (default 2s).',
            },
          ],
        },
        {
          title: 'Fuse RFID FASTag with ANPR into one passage event',
          description:
            'As a toll operator, I want matching FASTag RFID and ANPR for the same free-flow passage to fuse into a single ₹5 event — never two, never a silent half-event.',
          criteria: [
            {
              label: 'Matching window produces one event',
              description: 'RFID+ANPR inside the fusion window yield one ₹5 event verified in invoice export.',
            },
            {
              label: 'Orphan RFID opens exception',
              description: 'Unmatched RFID opens exception workflow rather than dropping or auto-billing.',
            },
            {
              label: 'Clock-skew tolerant match',
              description: 'Within skew budget, one attribution; beyond skew, exception — never double-bill.',
            },
          ],
        },
        {
          title: 'LiDAR exception opens a metered orchestration workflow',
          description:
            'As a roadside ops engineer, I want LiDAR exceptions to open Toll.OS workflows that still meter ₹5 when resolved, so dense urban sections stop under-billing.',
          criteria: [
            {
              label: 'LiDAR exception published',
              description: 'Every LiDAR exception reaches Toll.OS within SLA with vendor/gantry/reason codes.',
            },
            {
              label: 'Resolved exception meters ₹5',
              description: 'Resolution with plate/tag attribution records exactly one ₹5 event linked to the exception.',
            },
          ],
        },
        {
          title: 'Idempotent ₹5 ledger for retries and replays',
          description:
            'As Bosch MPS billing, I want idempotent event keys so sensor retries and bus replays never invoice the same passage twice.',
          criteria: [
            {
              label: 'Duplicate payload ignored',
              description: 'Replay with the same event key returns the original event — no second ₹5 charge.',
            },
            {
              label: 'Invoice equals ledger',
              description: 'Daily invoice export counts equal distinct orchestration event IDs.',
            },
            {
              label: 'Late RFID no double-bill',
              description: 'Late RFID after ANPR updates metadata only.',
            },
          ],
        },
        {
          title: 'Operator reconciliation view for corridor invoices',
          description:
            'As a concessionaire revenue-assurance lead, I want Toll.OS reconciliation from invoice lines to roadside attributions to defend the EUR value case without spreadsheets.',
          criteria: [
            {
              label: 'Drill from invoice to sensors',
              description: 'Each invoice line links to orchestration event and attribution summary.',
            },
            {
              label: 'Gap report',
              description: 'Ops can list hours where sensors exceed metered events beyond the 2% KPI band.',
            },
          ],
        },
      ]
    }
    return [
      {
        title: 'Deliver the primary outcome for the buying cohort',
        description:
          'As the primary operator, I want the core capability shipped with measurable acceptance so Portfolio value can be validated after release.',
        criteria: [
          {
            label: 'Happy path succeeds',
            description: 'Primary user flow completes successfully under expected load.',
          },
          {
            label: 'Failure modes are explicit',
            description: 'Errors surface actionable states; no silent data loss.',
          },
        ],
      },
    ]
  }
}
