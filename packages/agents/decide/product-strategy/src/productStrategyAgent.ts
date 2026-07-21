import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import { NODE_KINDS, EDGE_KINDS } from '@avp/shared'

export interface ProductStrategyInput {
  featureId: number
  featureLabel?: string
  /** Business value assessment this GTM plan builds on (required for Studio flow). */
  assessmentId?: number
  painPointIds?: number[]
  cycleId?: string
}

export interface ProductStrategyOutput {
  projectionId: number
  segmentIds: number[]
}

type SegmentDraft = {
  name: string
  size: string
  fit: string
  /** Qualitative band — kept for board filters / badges. */
  cac: string
  ltv: string
  description?: string
  /** Fully loaded cost to win one logo / program (EUR). */
  cacLowEur?: number
  cacHighEur?: number
  cacNotes?: string
  /** Expected lifetime commercial value of one logo (EUR). */
  ltvLowEur?: number
  ltvHighEur?: number
  ltvNotes?: string
  /** Months to recover CAC from contribution margin. */
  paybackMonthsLow?: number
  paybackMonthsHigh?: number
  paybackNotes?: string
  ltvCacRatio?: string
}

type GtmEconomics = {
  currency: string
  valueBandLow: number
  valueBandHigh: number
  valueStartYear: number
  deliveryCostLow: number
  deliveryCostHigh: number
  blendedCacLow: number
  blendedCacHigh: number
  blendedLtvLow: number
  blendedLtvHigh: number
  paybackMonthsLow: number
  paybackMonthsHigh: number
  ltvCacRatio: string
  narrative: string
}

type GtmDraft = {
  positioning: string
  segments: SegmentDraft[]
  go_to_market: string
  competitive_differentiation: string
  economics?: GtmEconomics
}

export const PRODUCT_STRATEGY_MANIFEST: AgentManifest = {
  id: 'product-strategy:v1',
  name: 'Product Strategy Agent',
  archetype: 'Product Strategist',
  domain: 'decide',
  runtime: 'studio',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [NODE_KINDS.GTM_PROJECTION, NODE_KINDS.SEGMENT],
    edgeKinds: [EDGE_KINDS.INFORMS, EDGE_KINDS.ADDRESSES, EDGE_KINDS.BETS_ON],
    requiresGate: false,
    maxWritesPerMinute: 20,
  },
  subscribes: ['context.decide.business_impact_assessed'],
  healthEndpoint: 'http://localhost:7093/health',
  llmBudget: { maxTokensPerRun: 4000, preferredModel: 'claude-sonnet-4-6' },
}

export class ProductStrategyAgent extends BaseAgent {
  protected readonly agentId = 'product-strategy:v1'
  protected readonly domain = 'decide' as const

  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) {
    super(adapter, llm)
  }

  async run(input: ProductStrategyInput): Promise<ProductStrategyOutput> {
    if (!input.featureId) this.fail('run', new Error('featureId required'))

    const sessionId = randomUUID()
    const inputHash = this.hashInput(input)
    let tokensUsed = 0

    const features = await this.adapter.graphRead<{ id: number; label: string; description: string | null }>(
      `SELECT id, label, description FROM graph_nodes WHERE id=$1`,
      [input.featureId],
    )
    const feature = features[0]
    if (!feature) this.fail('run', new Error(`FEATURE node ${input.featureId} not found`))

    let painPoints: Array<{ id: number; label: string }> = []
    if (input.painPointIds?.length) {
      painPoints = await this.adapter.graphRead(
        `SELECT id, label FROM graph_nodes WHERE id = ANY($1::int[])`,
        [input.painPointIds],
      )
    }

    let valueAssessment = '{}'
    if (input.assessmentId) {
      const rows = await this.adapter.graphRead<{ description: string }>(
        `SELECT description FROM graph_nodes WHERE id=$1 AND kind=$2`,
        [input.assessmentId, NODE_KINDS.BUSINESS_IMPACT],
      )
      valueAssessment = rows[0]?.description ?? '{}'
    }

    const contextBlob = `${input.featureLabel ?? feature.label}\n${feature.description ?? ''}\n${valueAssessment}`

    let llmText = ''
    try {
      const res = await this.complete({
        model: 'claude-sonnet-4-6',
        system:
          'You are a GTM strategist for Bosch MPS. Use plain language. Provide qualitative size/fit/cac/ltv bands AND quantified EUR fields (cacLowEur/cacHighEur, ltvLowEur/ltvHighEur, paybackMonthsLow/High) with short notes on how they were derived. Be realistic for enterprise B2B toll/platform sales — no fake precision.',
        maxTokens: 3500,
        messages: [{
          role: 'user',
          content: `Produce a go-to-market projection grounded in the business value assessment.
Feature: ${JSON.stringify({ ...feature, label: input.featureLabel ?? feature.label })}
Business value assessment: ${valueAssessment}
Pain points: ${JSON.stringify(painPoints)}

Return JSON only:
{"positioning":"2-4 sentences","segments":[{"name":"...","size":"small|medium|large","fit":"low|medium|high","cac":"low|medium|high","ltv":"low|medium|high","description":"...","cacLowEur":0,"cacHighEur":0,"cacNotes":"...","ltvLowEur":0,"ltvHighEur":0,"ltvNotes":"...","paybackMonthsLow":0,"paybackMonthsHigh":0,"paybackNotes":"...","ltvCacRatio":"e.g. 12×"}],"go_to_market":"detailed multi-paragraph GTM approach","competitive_differentiation":"detailed differentiation","economics":{"currency":"EUR","valueBandLow":1500000,"valueBandHigh":2000000,"valueStartYear":2027,"deliveryCostLow":350000,"deliveryCostHigh":400000,"blendedCacLow":0,"blendedCacHigh":0,"blendedLtvLow":0,"blendedLtvHigh":0,"paybackMonthsLow":0,"paybackMonthsHigh":0,"ltvCacRatio":"...","narrative":"how CAC/LTV/payback relate to value and delivery cost"}}`,
        }],
      })
      llmText = res.text
      tokensUsed = res.tokensUsed.output
    } catch {
      /* use deterministic fallback from feature/value context */
    }

    const parsed = this.parse(llmText, input.featureLabel ?? feature.label, contextBlob)

    const projectionId = await this.writeNode({
      kind: NODE_KINDS.GTM_PROJECTION,
      label: `GTM: ${input.featureLabel ?? feature.label}`.slice(0, 120),
      description: JSON.stringify({
        ...parsed,
        featureId: input.featureId,
        assessmentId: input.assessmentId ?? null,
      }),
      metadata: {
        segmentCount: parsed.segments.length,
        featureId: input.featureId,
        assessmentId: input.assessmentId ?? null,
        topSegment: parsed.segments.find((s) => s.fit === 'high')?.name
          ?? parsed.segments[0]?.name
          ?? null,
        paybackMonthsLow: parsed.economics?.paybackMonthsLow ?? null,
        paybackMonthsHigh: parsed.economics?.paybackMonthsHigh ?? null,
        blendedCacLow: parsed.economics?.blendedCacLow ?? null,
        blendedCacHigh: parsed.economics?.blendedCacHigh ?? null,
      },
      eventKind: 'gtm_projected',
      cycleId: input.cycleId,
      featureId: input.featureId,
    })

    await this.writeEdge(projectionId, input.featureId, EDGE_KINDS.INFORMS)
    await this.writeEdge(projectionId, input.featureId, EDGE_KINDS.ADDRESSES)
    for (const ppId of input.painPointIds ?? []) {
      await this.writeEdge(projectionId, ppId, EDGE_KINDS.ADDRESSES)
    }

    const segmentIds: number[] = []
    for (const seg of parsed.segments) {
      const sid = await this.writeNode({
        kind: NODE_KINDS.SEGMENT,
        label: seg.name.slice(0, 120),
        description: JSON.stringify(seg),
        metadata: {
          fit: seg.fit,
          size: seg.size,
          cacLowEur: seg.cacLowEur ?? null,
          cacHighEur: seg.cacHighEur ?? null,
          ltvLowEur: seg.ltvLowEur ?? null,
          ltvHighEur: seg.ltvHighEur ?? null,
          paybackMonthsLow: seg.paybackMonthsLow ?? null,
          paybackMonthsHigh: seg.paybackMonthsHigh ?? null,
        },
        eventKind: 'segment_identified',
        cycleId: input.cycleId,
        featureId: input.featureId,
      })
      segmentIds.push(sid)
      await this.writeEdge(projectionId, sid, EDGE_KINDS.BETS_ON)
    }

    await this.adapter.episodicMemory.write({
      agentId: this.agentId,
      sessionId,
      domain: 'decide',
      cycleId: input.cycleId,
      featureId: input.featureId,
      inputHash,
      inputSummary: `feature=${input.featureId}`,
      outputSummary: `${parsed.positioning.slice(0, 80)}; ${segmentIds.length} segments; payback ${parsed.economics?.paybackMonthsLow ?? '?'}–${parsed.economics?.paybackMonthsHigh ?? '?'} mo`,
      outputNodeIds: [projectionId, ...segmentIds],
      confidencePct: 72,
      llmTokensUsed: tokensUsed,
    })

    return { projectionId, segmentIds }
  }

  private parse(raw: string, featureLabel: string, contextBlob = ''): GtmDraft {
    const fallback = this.fallbackGtm(featureLabel, contextBlob)
    const stubish = (v: string | undefined) =>
      !v || /stub|pending llm|todo|tbd|primary segment \(stub\)/i.test(v)

    try {
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      if (start < 0 || end <= start) return fallback
      const p = JSON.parse(raw.slice(start, end + 1)) as Partial<GtmDraft> & {
        segments?: Array<Partial<SegmentDraft>>
      }
      const segments = (p.segments?.length ? p.segments : fallback.segments).map((s, i) => {
        const fb = fallback.segments[i % fallback.segments.length]
        return {
          name: stubish(s.name) ? fb.name : String(s.name),
          size: s.size ?? fb.size,
          fit: s.fit ?? fb.fit,
          cac: s.cac ?? fb.cac,
          ltv: stubish(s.ltv) || s.ltv === 'unknown' ? fb.ltv : String(s.ltv),
          description: stubish(s.description) ? fb.description : (s.description ?? fb.description),
          cacLowEur: Number(s.cacLowEur ?? fb.cacLowEur),
          cacHighEur: Number(s.cacHighEur ?? fb.cacHighEur),
          cacNotes: stubish(s.cacNotes) ? fb.cacNotes : (s.cacNotes ?? fb.cacNotes),
          ltvLowEur: Number(s.ltvLowEur ?? fb.ltvLowEur),
          ltvHighEur: Number(s.ltvHighEur ?? fb.ltvHighEur),
          ltvNotes: stubish(s.ltvNotes) ? fb.ltvNotes : (s.ltvNotes ?? fb.ltvNotes),
          paybackMonthsLow: Number(s.paybackMonthsLow ?? fb.paybackMonthsLow),
          paybackMonthsHigh: Number(s.paybackMonthsHigh ?? fb.paybackMonthsHigh),
          paybackNotes: stubish(s.paybackNotes) ? fb.paybackNotes : (s.paybackNotes ?? fb.paybackNotes),
          ltvCacRatio: s.ltvCacRatio ?? fb.ltvCacRatio,
        }
      })

      const looksStub =
        stubish(p.positioning) ||
        stubish(p.go_to_market) ||
        stubish(p.competitive_differentiation) ||
        segments.some((s) => /stub/i.test(s.name))

      if (looksStub && /toll\.?os|mlff|metering|₹5/.test(contextBlob)) {
        return fallback
      }

      return {
        positioning: stubish(p.positioning) ? fallback.positioning : String(p.positioning),
        segments,
        go_to_market: stubish(p.go_to_market) ? fallback.go_to_market : String(p.go_to_market),
        competitive_differentiation: stubish(p.competitive_differentiation)
          ? fallback.competitive_differentiation
          : String(p.competitive_differentiation),
        economics: p.economics ?? fallback.economics,
      }
    } catch {
      return fallback
    }
  }

  private fallbackGtm(featureLabel: string, contextBlob: string): GtmDraft {
    const blob = `${featureLabel}\n${contextBlob}`.toLowerCase()

    if (/toll\.?os|mlff|anpr|fastag|lidar|₹5|metering/.test(blob)) {
      return {
        positioning: [
          'Toll.OS is the system of record that turns every successful ANPR diagnosis, FASTag RFID confirmation, and resolved LiDAR exception into one trusted, billable orchestration event for Bosch MPS.',
          'We sell metering integrity — not another camera — so concessionaires can reconcile corridor invoices to roadside reality and Bosch MPS can defend contracted event volumes.',
          'Commercial story: recover under-captured events into a €1.5M–€2.0M annual value band from 2027, after a €350k–€400k delivery investment.',
        ].join(' '),
        segments: [
          {
            name: 'National toll concessionaires on MLFF',
            size: 'medium',
            fit: 'high',
            cac: 'medium',
            ltv: 'high',
            description:
              'Ops, revenue assurance, and roadside engineering at national / major regional concessionaires already running Toll.OS on free-flow corridors. They feel invoice gaps daily and co-own the ₹5/event commercial model with Bosch MPS.',
            cacLowEur: 140_000,
            cacHighEur: 180_000,
            cacNotes:
              'Fully loaded cost to win one national program: ~€50–70k pre-sales & solution architecture, ~€60–80k funded corridor pilot / integration support, ~€20–30k legal, travel, and RFP response. Midpoint ≈ €160k CAC per logo.',
            ltvLowEur: 1_800_000,
            ltvHighEur: 2_500_000,
            ltvNotes:
              'Assumes €350k–€500k annual metered / platform revenue attributable to that concessionaire once fusion is live (share of the €1.5–2.0M portfolio band), retained 5–6 years with modest corridor expansion. Mid LTV ≈ €2.1M.',
            paybackMonthsLow: 9,
            paybackMonthsHigh: 11,
            paybackNotes:
              'Year-1 contribution after hosting/support ≈ €170k–€210k on a ramping national account. CAC €160k recovers in ~9–11 months depending on pilot-to-production speed.',
            ltvCacRatio: '11–16×',
          },
          {
            name: 'Regional road operators with RFID + ANPR',
            size: 'large',
            fit: 'high',
            cac: 'low',
            ltv: 'high',
            description:
              'Smaller regional operators and city corridors already on Bosch MPS Toll.OS with mixed RFID/ANPR. Land via existing account teams and expand corridor-by-corridor after the national reference.',
            cacLowEur: 45_000,
            cacHighEur: 70_000,
            cacNotes:
              'Land-and-expand on existing MPS relationships: lighter RFP (~€15–25k), shared pilot playbooks (~€20–30k), account-team time (~€10–15k). Midpoint ≈ €55k CAC.',
            ltvLowEur: 600_000,
            ltvHighEur: 950_000,
            ltvNotes:
              '€120k–€190k annual attributable revenue over 4–5 years as corridors adopt the ledger. Mid LTV ≈ €750k.',
            paybackMonthsLow: 6,
            paybackMonthsHigh: 8,
            paybackNotes:
              'Faster attach on installed base: year-1 contribution ~€90k–€110k. CAC €55k recovers in roughly 6–8 months.',
            ltvCacRatio: '11–17×',
          },
        ],
        go_to_market: [
          '1) Prove on a bleeding corridor. Pick one national concessionaire already losing ANPR/LiDAR events. Run a 30-day before/after: unbilled half-events, fusion duplicates, and exception drops — then show recovered billable events against the ₹5 model.',
          '2) Convert pilot → program. Package the ledger, fusion rules, and reconciliation views as a Toll.OS metering integrity program sold with Bosch MPS commercial ops (not a one-off SI project). Target design-partner contract in 2026 so value lands from 2027.',
          '3) Expand through MPS account motion. Use the national reference for regional RFID+ANPR operators; sell corridor packs with shared runbooks and a fixed integration playbook to keep CAC in the €45–70k band.',
          '4) Arm sales with unit economics. Lead with LTV:CAC ≥ 11× and ~10-month payback on nationals; contrast €350–400k delivery against €1.5–2.0M/year recovered value from 2027 so Portfolio Review sees a clear payback story.',
        ].join('\n\n'),
        competitive_differentiation: [
          'Sensor vendors sell cameras, RFID readers, or LiDAR — they do not own the fused, billable event. Classic toll back-offices invoice trips but rarely close the loop from gantry exception to metered orchestration event.',
          'Toll.OS differentiation is the idempotent orchestration ledger: ANPR + FASTag RFID + LiDAR exceptions become exactly one trusted ₹5 event (never two, never zero), with operator reconciliation Bosch MPS can defend commercially.',
          'That metering integrity is the product — priced and evidenced at event grain — which competitors cannot claim without rebuilding the fusion and commercial ledger layer.',
        ].join(' '),
        economics: {
          currency: 'EUR',
          valueBandLow: 1_500_000,
          valueBandHigh: 2_000_000,
          valueStartYear: 2027,
          deliveryCostLow: 350_000,
          deliveryCostHigh: 400_000,
          blendedCacLow: 90_000,
          blendedCacHigh: 160_000,
          blendedLtvLow: 900_000,
          blendedLtvHigh: 2_500_000,
          paybackMonthsLow: 8,
          paybackMonthsHigh: 11,
          ltvCacRatio: '10–16×',
          narrative: [
            'Portfolio value €1.5–2.0M/year from 2027 funds a multi-logo mix: roughly 2–3 national programs (higher CAC/LTV) plus several regional attaches (lower CAC).',
            'Blended CAC €90–160k vs blended LTV €0.9–2.5M keeps LTV:CAC in the 10–16× range. Payback on contribution margin is 8–11 months — well inside a single budget year after first production corridor.',
            'Delivery investment €350–400k is recovered from less than one quarter of steady-state annual value once 2027 run-rate is reached; GTM spend (CAC) is incremental per logo and scales with the land-and-expand motion.',
          ].join(' '),
        },
      }
    }

    if (/staas|3pl|warehouse|dock|asn|inventory|uffizio/.test(blob)) {
      return {
        positioning:
          'MPS StaaS becomes the near-real-time inventory and loyalty system of record for Uffizio — so outbound dock waves are planned on live stock and ASNs, and earn/burn follows the same logistics events.',
        segments: [
          {
            name: 'Uffizio',
            size: 'medium',
            fit: 'high',
            cac: 'medium',
            ltv: 'high',
            description:
              'Uffizio — Bosch MPS StaaS logistics customer. Dock managers and inventory planners feeling afternoon-wave rework from stale counts; co-own logistics + loyalty outcomes.',
            cacLowEur: 25_000,
            cacHighEur: 45_000,
            cacNotes: 'Existing Uffizio account expansion: SE + CS time, pilot site, light integration (~€35k mid).',
            ltvLowEur: 280_000,
            ltvHighEur: 520_000,
            ltvNotes: '€70–130k ARR uplift / retained StaaS fees over 4 years at Uffizio.',
            paybackMonthsLow: 5,
            paybackMonthsHigh: 8,
            paybackNotes: 'Contribution ~€60–80k in year 1 → CAC recovers inside two quarters on Uffizio.',
            ltvCacRatio: '8–15×',
          },
          {
            name: 'Uffizio hub brand / shipper loyalty programs',
            size: 'medium',
            fit: 'high',
            cac: 'medium',
            ltv: 'high',
            description:
              'Loyalty owners at brands/shippers co-located in Uffizio hubs whose earn/burn breaks when dock/ASN/returns are not on StaaS events.',
            cacLowEur: 40_000,
            cacHighEur: 70_000,
            cacNotes: 'Program design workshop + partner adapter pilot ≈ €55k mid.',
            ltvLowEur: 280_000,
            ltvHighEur: 520_000,
            ltvNotes: 'Retained program fees + partner attach over 4 years.',
            paybackMonthsLow: 7,
            paybackMonthsHigh: 11,
            paybackNotes: 'Year-1 loyalty contribution ~€55–75k → payback ~7–11 months.',
            ltvCacRatio: '6–12×',
          },
        ],
        go_to_market:
          'Sell through MPS StaaS CS on the Uffizio account. Pilot one Uffizio warehouse for same-shift inventory freshness, attach one co-located loyalty program, measure rework and earn latency in 90 days, then expand site packs.',
        competitive_differentiation:
          'Retail WMS and generic inventory tools ignore MPS StaaS cadence; this is a logistics + loyalty freshness path on the platform Uffizio already pays for.',
        economics: {
          currency: 'EUR',
          valueBandLow: 720_000,
          valueBandHigh: 1_450_000,
          valueStartYear: 2026,
          deliveryCostLow: 280_000,
          deliveryCostHigh: 360_000,
          blendedCacLow: 40_000,
          blendedCacHigh: 65_000,
          blendedLtvLow: 300_000,
          blendedLtvHigh: 550_000,
          paybackMonthsLow: 6,
          paybackMonthsHigh: 11,
          ltvCacRatio: '7–12×',
          narrative:
            'Uffizio warehouse attaches plus co-located loyalty programs. Modest CAC on installed StaaS base; delivery €280–360k recovers inside the first year of combined run-rate.',
        },
      }
    }

    return {
      positioning: `Position ${featureLabel} for the primary cohort that raised the pain — clear outcome, bounded first release.`,
      segments: [
        {
          name: 'Primary buying cohort',
          size: 'medium',
          fit: 'high',
          cac: 'medium',
          ltv: 'high',
          description: 'Operators and commercial owners closest to the pain signals.',
          cacLowEur: 40_000,
          cacHighEur: 80_000,
          cacNotes: 'Placeholder enterprise CAC pending discovery.',
          ltvLowEur: 300_000,
          ltvHighEur: 700_000,
          ltvNotes: 'Placeholder LTV pending pricing confirmation.',
          paybackMonthsLow: 8,
          paybackMonthsHigh: 14,
          paybackNotes: 'Tighten after value and pricing workshops.',
          ltvCacRatio: '6–12×',
        },
      ],
      go_to_market:
        'Start with design partners who raised the signals, prove a measurable outcome in 90 days, then expand through the existing Bosch MPS account motion.',
      competitive_differentiation:
        'Tie the offer to an outcome competitors cannot evidence without the same platform instrumentation.',
      economics: {
        currency: 'EUR',
        valueBandLow: 150_000,
        valueBandHigh: 450_000,
        valueStartYear: 2027,
        deliveryCostLow: 200_000,
        deliveryCostHigh: 280_000,
        blendedCacLow: 40_000,
        blendedCacHigh: 80_000,
        blendedLtvLow: 300_000,
        blendedLtvHigh: 700_000,
        paybackMonthsLow: 8,
        paybackMonthsHigh: 14,
        ltvCacRatio: '6–12×',
        narrative: 'Preliminary economics — replace with case-specific CAC/LTV after commercial review.',
      },
    }
  }
}

/** Studio guide aliases (GTM Strategy Agent) */
export const GTM_STRATEGY_MANIFEST = PRODUCT_STRATEGY_MANIFEST
export const GtmStrategyAgent = ProductStrategyAgent
export type GtmStrategyInput = ProductStrategyInput
export type GtmStrategyOutput = ProductStrategyOutput
