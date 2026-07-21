/**
 * Full-loop StaaS demo: 3PL logistics integration + loyalty management.
 * Decide → Admit → Define → Build → Ship → Learn (loop closed).
 */
import { randomUUID } from 'node:crypto'
import { query, queryOne } from './pool.js'

export const STAAS_PAIN =
  'StaaS 3PL inventory lag and fragmented loyalty break dock SLAs and member value'
export const STAAS_FEATURE =
  'StaaS 3PL logistics integration + loyalty management'

async function insertPainPoint(
  label: string,
  description: string,
  meta: Record<string, unknown>,
  quotes: string[],
) {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata, written_by_agent, trace_id)
     VALUES ('PAIN_POINT', $1, $2, $3::jsonb, 'seed', $4) RETURNING id`,
    [label.slice(0, 120), description, JSON.stringify({ ...meta, demo: true }), randomUUID()],
  )
  for (const q of quotes.slice(0, 4)) {
    await query(
      `INSERT INTO graph_nodes (kind, label, description, metadata, written_by_agent, trace_id)
       VALUES ('CUSTOMER_SIGNAL', $1, $2, $3::jsonb, 'seed', $4)`,
      [
        q.slice(0, 80),
        q,
        JSON.stringify({
          demo: true,
          painPointLabel: label,
          cohort: (meta.cohorts as string[] | undefined)?.[0] ?? 'demo',
          type: 'pain_point',
        }),
        randomUUID(),
      ],
    )
  }
  return row!.id
}

async function insertFeature(args: {
  label: string
  description: string
  product: string
  painPointId: number
  brief: Record<string, unknown>
}) {
  const feature = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata, written_by_agent, trace_id)
     VALUES ('FEATURE', $1, $2, $3::jsonb, 'seed', $4) RETURNING id`,
    [
      args.label.slice(0, 120),
      args.description,
      JSON.stringify({
        stage: 'INTAKE',
        product: args.product,
        sentForSizing: true,
        demo: true,
      }),
      randomUUID(),
    ],
  )
  const brief = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('BRIEF', $1, $2, $3::jsonb) RETURNING id`,
    [
      `Brief: ${args.label}`.slice(0, 120),
      JSON.stringify(args.brief),
      JSON.stringify({ isDuplicate: false, demo: true }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'MOTIVATES'), ($3,$2,'MOTIVATES')`,
    [args.painPointId, feature!.id, brief!.id],
  )
  return feature!.id
}

async function insertAssessment(
  featureId: number,
  kind: 'BUSINESS_IMPACT' | 'DEV_IMPACT' | 'GTM_PROJECTION',
  label: string,
  data: Record<string, unknown>,
  metadata: Record<string, unknown>,
  edgeKind: string,
) {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
    [kind, label.slice(0, 120), JSON.stringify({ ...data, featureId }), JSON.stringify({ ...metadata, demo: true })],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,$3)`,
    [row!.id, featureId, edgeKind],
  )
  return row!.id
}

async function ensureCycle(featureId: number, label: string, stage: string) {
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM cycles WHERE feature_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [featureId],
  )
  if (existing) {
    await query(`UPDATE cycles SET current_stage=$1, label=$2, updated_at=NOW() WHERE id=$3`, [
      stage,
      label.slice(0, 120),
      existing.id,
    ])
    return existing
  }
  return queryOne<{ id: string }>(
    `INSERT INTO cycles (label, workspace_id, current_stage, feature_id, metadata)
     VALUES ($1, 'default', $2, $3, '{"demo":true}'::jsonb) RETURNING id`,
    [label.slice(0, 120), stage, featureId],
  )
}

export async function seedStaas(): Promise<number> {
  const painId = await insertPainPoint(
    STAAS_PAIN,
    '3PL sites on MPS StaaS still plan docks on 4–12h-stale inventory/ASNs, while loyalty earn/burn and partner offers are fragmented across retail-era APIs — so logistics SLAs and member value both erode.',
    {
      importanceScore: 0.88,
      signalCount: 34,
      tags: ['StaaS', '3PL', 'logistics', 'loyalty'],
      cohorts: ['uffizio', 'logistics', 'loyalty'],
      trend: 'growing',
    },
    [
      "Our Uffizio StaaS inventory is still yesterday's when we release the afternoon dock wave.",
      'Need near-real-time StaaS stock for Uffizio logistics warehouses, not retail store sync.',
      'Loyalty earn at the dock and partner burn never land in the same StaaS member view.',
      'Members see broken points after returns because loyalty is not tied to live ASN/receipt state.',
    ],
  )

  const featureId = await insertFeature({
    label: STAAS_FEATURE,
    description:
      'Build StaaS logistics integration for Uffizio (near-real-time inventory + ASN + dock planning) and a unified loyalty management layer (earn/burn, tiers, partner offers) on the same platform.',
    product: 'StaaS',
    painPointId: painId,
    brief: {
      title: STAAS_FEATURE,
      problemStatement: [
        'Uffizio — Bosch MPS Store-as-a-Service customer for logistics — uses StaaS for warehouse inventory and ASN visibility, but updates lag 4–12 hours. Outbound dock schedules are built on yesterday’s stock; mis-planned trailers drive rework, missed SLAs, and idle labour.',
        'In parallel, loyalty earn/burn for Uffizio’s logistics-linked retail and shipper programs is fragmented: points post late, partner offers do not see live dock/ASN state, and returns break member balances because loyalty is not integrated with logistics events.',
        'StaaS must deliver both for Uffizio: a logistics integration path (warehouse inventory, ASN, dock planning) and a loyalty management path (member ledger, tiers, partner earn/burn) that share a consistent event and identity model — otherwise MPS loses trust as the system of record for Uffizio ops and member value.',
      ].join('\n\n'),
      customerSegment: [
        'Primary: Uffizio — MPS StaaS logistics customer (dock managers, inventory planners) and loyalty program owners for brands/shippers co-located in Uffizio hubs.',
        'Secondary: Bosch MPS StaaS product, logistics CS, and loyalty commercial teams accountable for Uffizio SLAs and renewals.',
        'Tertiary: end members and brand partners who feel late loads and broken points as the same platform failure.',
      ].join(' '),
      evidenceSummary: [
        '34 Uffizio signals: 16 logistics (dock rework / stale ASN) + 18 loyalty (late earn, partner burn failures, returns mismatch) — tags StaaS / Uffizio / logistics / loyalty, trend growing.',
        'Voice: “Afternoon dock wave still sees yesterday’s stock.” “Loyalty earn at the dock never lands in the same StaaS member view.” “Returns break points because loyalty is not tied to live ASN/receipt state.”',
        'Combined commercial case for Uffizio: dock rework reduction (~€180/trailer) plus loyalty retention/partner attach — modelled €720K–€1.45M/year once both paths are live.',
      ].join('\n\n'),
      isDuplicate: false,
      duplicateOf: null,
      recommendation: [
        'Admit as one StaaS program for Uffizio with two workstreams: (A) logistics integration — near-real-time inventory/ASN/dock planning; (B) loyalty management — member ledger, tiers, partner earn/burn wired to logistics events.',
        'Do not expand into full WMS or a greenfield loyalty SaaS — stay on StaaS platform APIs already sold to Uffizio and brand partners.',
        'Success in 90 days: same-shift dock planning on live stock + earn/burn latency p95 under program SLA; in 180 days: measurable dock rework drop and loyalty complaint rate drop.',
      ].join('\n\n'),
    },
  })

  const valueId = await insertAssessment(
    featureId,
    'BUSINESS_IMPACT',
    'Business impact: StaaS 3PL logistics + loyalty',
    {
      executiveSummary:
        'Near-real-time Uffizio logistics on StaaS plus integrated loyalty management is worth about €720K–€1.45M/year: dock rework and missed SLAs down on the logistics side; member retention and partner attach up on the loyalty side. Value ramps as Uffizio warehouses and programs go live through 2026–2027.',
      valueLow: 720000,
      valueHigh: 1450000,
      valueCurrency: 'EUR',
      valuePeriod: 'year',
      valueStartYear: 2026,
      confidence: 60,
      assumptions: [
        'Uffizio warehouses adopt near-real-time StaaS logistics sync (design-partner sites first, then expansion hubs).',
        'Dock rework averages ~€180 per mis-planned trailer; 25–35% reduction in 90 days.',
        'Brand/shipper loyalty programs co-located at Uffizio hubs see earn/burn latency and returns accuracy improve enough to lift retained member value ~€40–70k/program/year.',
        'Retail POS sync paths remain unchanged — logistics + loyalty profiles only.',
      ],
      hypotheses: [
        {
          kpi: 'dock_rework_rate',
          direction: 'decrease',
          magnitudePct: 30,
          timeframeDays: 90,
          attributionMethod: 'before_after',
          rationale: 'Live ASN/on-hand removes morning recount cycles for outbound waves.',
        },
        {
          kpi: 'loyalty_earn_latency_p95',
          direction: 'decrease',
          magnitudePct: 50,
          timeframeDays: 90,
          attributionMethod: 'before_after',
          rationale: 'Dock/ASN-linked earn events post to the member ledger inside program SLA.',
        },
        {
          kpi: 'loyalty_returns_mismatch_rate',
          direction: 'decrease',
          magnitudePct: 40,
          timeframeDays: 120,
          attributionMethod: 'before_after',
          rationale: 'Burn/earn adjustments follow live receipt/ASN state instead of nightly batch.',
        },
      ],
    },
    {
      valueLow: 720000,
      valueHigh: 1450000,
      confidence: 60,
      valueCurrency: 'EUR',
      valueStartYear: 2026,
    },
    'ESTIMATES',
  )

  const effortId = await insertAssessment(
    featureId,
    'DEV_IMPACT',
    'Engineering estimate: StaaS 3PL logistics + loyalty',
    {
      summary: [
        'Two coordinated workstreams on MPS StaaS: logistics integration (warehouse inventory, ASN, dock planning consumers) and loyalty management (member ledger, tiers, partner earn/burn, returns hooks).',
        'Fully loaded delivery ~€280k–€360k over 12–16 weeks with a team of four (logistics, loyalty, platform, QA). Not a WMS or greenfield loyalty rebuild.',
      ].join(' '),
      effortWeeksLow: 12,
      effortWeeksHigh: 16,
      effortCostLow: 280000,
      effortCostHigh: 360000,
      effortCostCurrency: 'EUR',
      complexity: 'high',
      technicalRisks: [
        'ASN publishers vary by 3PL WMS — need a freshness contract and adapter kit per major vendor.',
        'Peak dock windows amplify sync lag; back-pressure must not stall retail sync paths.',
        'Loyalty partner APIs differ on earn/burn idempotency; double-earn on retries is a commercial risk.',
        'Returns and ASN corrections must reverse loyalty consistently without orphan points.',
        'Shared member/site identity across logistics and loyalty domains can drift if not modelled once.',
      ],
      assumptions: [
        'Reuse existing StaaS inventory and member services; add logistics profiles + loyalty event bus.',
        'Cost ~€3.5–4.0k fully loaded per person-week × 4 people × 12–16 weeks → €280–360k.',
        'Uffizio design-partner site + one co-located loyalty program available for pilot soak.',
      ],
      workstreams: [
        'Warehouse inventory + ASN near-real-time pipeline (logistics profile)',
        'Dock planning consumer APIs and SLA dashboards',
        'Loyalty member ledger + tier engine',
        'Partner earn/burn adapters with idempotent keys',
        'Returns / ASN correction → loyalty adjustment hooks',
        'Shared site/member identity and event catalogue',
        'Pilot soak, runbooks, and dual-path observability',
      ],
      breakdown: { design: 14, implementation: 40, testing: 22, integration: 16, documentation: 8 },
      recommendedTeamSize: 4,
      applicableRegulations: ['Member PII / loyalty consent', '3PL data-processing agreements'],
      addressedRiskIndices: [],
      tShirt: 'L',
      storyPoints: 34,
      rationale: 'Dual-domain StaaS program (logistics + loyalty) on known platform surfaces.',
      codeComplexitySignal:
        'Closest analogues: prior StaaS sync latency work and retail loyalty batch jobs — logistics cadence is stricter; loyalty needs event-level idempotency like Toll.OS metering.',
    },
    {
      effortWeeksLow: 12,
      effortWeeksHigh: 16,
      effortCostLow: 280000,
      effortCostHigh: 360000,
      effortCostCurrency: 'EUR',
      complexity: 'high',
      recommendedTeamSize: 4,
    },
    'ESTIMATES',
  )

  const gtmId = await insertAssessment(
    featureId,
    'GTM_PROJECTION',
    'GTM: StaaS 3PL logistics + loyalty',
    {
      positioning:
        'MPS StaaS for Uffizio — live warehouse stock dock planners can trust, plus loyalty earn/burn that follows the same logistics events so members and partners see one truth.',
      segments: [
        {
          name: 'Uffizio',
          size: 'large',
          fit: 'high',
          cac: 'medium',
          ltv: 'high',
          description:
            'Uffizio — Bosch MPS StaaS logistics customer. Dock and inventory leads feeling afternoon-wave rework from stale stock; co-own logistics + loyalty outcomes with MPS.',
          cacLowEur: 35000,
          cacHighEur: 55000,
          cacNotes: 'Existing Uffizio account expansion: CS + SE + one-site pilot ≈ €45k mid.',
          ltvLowEur: 320000,
          ltvHighEur: 580000,
          ltvNotes: 'Logistics StaaS uplift + retained Uffizio warehouse sites over 4 years.',
          paybackMonthsLow: 6,
          paybackMonthsHigh: 9,
          paybackNotes: 'Year-1 logistics contribution ~€70–90k → CAC recovers inside three quarters on Uffizio.',
          ltvCacRatio: '8–13×',
        },
        {
          name: 'Uffizio hub brand / shipper loyalty programs',
          size: 'medium',
          fit: 'high',
          cac: 'medium',
          ltv: 'high',
          description:
            'Loyalty owners at brands/shippers co-located in Uffizio hubs whose earn/burn breaks when dock/ASN/returns are not on StaaS events.',
          cacLowEur: 40000,
          cacHighEur: 70000,
          cacNotes: 'Program design workshop + partner adapter pilot ≈ €55k mid.',
          ltvLowEur: 280000,
          ltvHighEur: 520000,
          ltvNotes: 'Retained program fees + partner attach over 4 years.',
          paybackMonthsLow: 7,
          paybackMonthsHigh: 11,
          paybackNotes: 'Year-1 loyalty contribution ~€55–75k → payback ~7–11 months.',
          ltvCacRatio: '6–12×',
        },
      ],
      go_to_market: [
        '1) Pilot one Uffizio site already reporting dock rework — prove same-shift inventory/ASN for one outbound wave.',
        '2) Attach one co-located loyalty program — wire dock/ASN/returns events into earn/burn; show member latency and returns accuracy.',
        '3) Package as StaaS Logistics + Loyalty hub SKU for Uffizio sold through MPS account teams (not separate products).',
        '4) Expand Uffizio site-by-site and program-by-program with fixed adapter playbooks to keep CAC in band.',
      ].join('\n\n'),
      competitive_differentiation:
        'Generic WMS sync and standalone loyalty engines do not share StaaS site/member identity. This program ties logistics freshness to loyalty event integrity on the platform Uffizio and brands already pay for.',
      economics: {
        currency: 'EUR',
        valueBandLow: 720000,
        valueBandHigh: 1450000,
        valueStartYear: 2026,
        deliveryCostLow: 280000,
        deliveryCostHigh: 360000,
        blendedCacLow: 40000,
        blendedCacHigh: 65000,
        blendedLtvLow: 300000,
        blendedLtvHigh: 550000,
        paybackMonthsLow: 6,
        paybackMonthsHigh: 11,
        ltvCacRatio: '7–12×',
        narrative:
          'Uffizio warehouse attaches plus co-located loyalty program attaches. Delivery €280–360k recovers inside the first year of combined run-rate; blended payback 6–11 months on contribution margin.',
      },
      featureId,
    },
    {
      segmentCount: 2,
      topSegment: 'Uffizio',
      paybackMonthsLow: 6,
      paybackMonthsHigh: 11,
      blendedCacLow: 40000,
      blendedCacHigh: 65000,
    },
    'INFORMS',
  )

  const cycle = await ensureCycle(featureId, STAAS_FEATURE, 'BUILD')

  for (const h of [
    {
      kpi: 'dock_rework_rate',
      direction: 'decrease',
      magnitudePct: 30,
      timeframeDays: 90,
      attributionMethod: 'before_after',
      rationale: 'Live ASN/on-hand removes morning recount cycles',
    },
    {
      kpi: 'loyalty_earn_latency_p95',
      direction: 'decrease',
      magnitudePct: 50,
      timeframeDays: 90,
      attributionMethod: 'before_after',
      rationale: 'Dock/ASN-linked earn posts inside program SLA',
    },
    {
      kpi: 'loyalty_returns_mismatch_rate',
      direction: 'decrease',
      magnitudePct: 40,
      timeframeDays: 120,
      attributionMethod: 'before_after',
      rationale: 'Returns adjustments follow live receipt/ASN state',
    },
  ]) {
    const hyp = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('VALUE_HYPOTHESIS', $1, $2, $3::jsonb) RETURNING id`,
      [
        `Bet: ${h.kpi}`,
        JSON.stringify(h),
        JSON.stringify({ committed: true, cycleId: cycle!.id, demo: true }),
      ],
    )
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'SUPPORTS')`,
      [hyp!.id, valueId],
    )
  }

  const packet = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES (
       'PORTFOLIO_PACKET', $1, $2,
       '{"valueScore":72,"riskScore":38,"recommendation":"ADMIT","decision":"admit","demo":true}'::jsonb
     ) RETURNING id`,
    [
      `Decision packet: ${STAAS_FEATURE}`,
      JSON.stringify({
        featureId,
        valueScore: 72,
        riskScore: 38,
        recommendation: 'ADMIT',
        summary:
          'Dual StaaS bet — 3PL logistics freshness plus loyalty management — clear value, bounded effort, admit into Define.',
        businessAssessmentId: valueId,
        engAssessmentId: effortId,
        projectionId: gtmId,
        decision: 'admit',
      }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES
       ($1,$2,'FUNDED_BY'), ($1,$3,'PACKET_INCLUDES'), ($1,$4,'PACKET_INCLUDES'), ($1,$5,'PACKET_INCLUDES')`,
    [packet!.id, featureId, valueId, effortId, gtmId],
  )

  const rationale =
    'Admit StaaS logistics integration and loyalty management for Uffizio as one program. Live inventory/ASN for docks plus event-accurate earn/burn is the StaaS hub story for Uffizio sites and co-located brand programs.'
  const dr = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata, written_by_agent, trace_id)
     VALUES ('DECISION_RECORD', $1, $2, $3::jsonb, 'human-gate', $4) RETURNING id`,
    [
      `PORTFOLIO_GATE: admit StaaS by CPO`,
      JSON.stringify({
        cycleId: cycle!.id,
        gate: 'PORTFOLIO_GATE',
        decision: 'admit',
        role: 'CPO',
        rationale,
        ts: Date.now(),
        featureId,
      }),
      JSON.stringify({
        gate: 'PORTFOLIO_GATE',
        decision: 'admit',
        role: 'CPO',
        cycleId: cycle!.id,
        demo: true,
      }),
      randomUUID(),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'APPROVES')`,
    [dr!.id, featureId],
  )

  console.log('Seeded StaaS: pain → case → value → effort → GTM → packet → Admit')
  await seedStaasRequirements(featureId)
  await seedStaasDomain(featureId)
  await seedStaasArchitecture(featureId)
  await seedStaasBuild(featureId)
  await seedStaasShipLearn(featureId)
  return featureId
}

async function seedStaasRequirements(featureId: number) {
  const stories = [
    {
      title: 'Near-real-time warehouse on-hand for 3PL dock waves',
      description:
        'As an Uffizio dock manager, I want StaaS on-hand quantities refreshed within the logistics SLA (minutes, not half a shift) so afternoon outbound waves use live stock.',
      criteria: [
        {
          label: 'Logistics sync cadence',
          description: 'Warehouse on-hand updates land in StaaS within the site logistics SLA (default ≤ 5 min p95).',
        },
        {
          label: 'Retail path isolated',
          description: 'Retail store sync cadence is unchanged; logistics profile does not slow POS paths.',
        },
        {
          label: 'Dock consumer reads live stock',
          description: 'Dock planning API returns the same on-hand StaaS shows in the warehouse inventory view.',
        },
      ],
    },
    {
      title: 'ASN freshness for inbound-to-outbound planning',
      description:
        'As an inventory planner, I want inbound ASNs visible in StaaS as soon as the 3PL WMS publishes them so outbound plans account for arriving stock.',
      criteria: [
        {
          label: 'ASN ingest adapters',
          description: 'Supported WMS ASN feeds map into the StaaS logistics ASN model with site + SKU identity.',
        },
        {
          label: 'Stale ASN flagged',
          description: 'ASNs older than the freshness contract are marked stale in dock planning, never silently trusted.',
        },
      ],
    },
    {
      title: 'Loyalty earn on logistics-linked receipt events',
      description:
        'As a loyalty program owner, I want member earn to post when dock/ASN/receipt events confirm fulfilment so points are not stuck on nightly retail batches.',
      criteria: [
        {
          label: 'Earn from logistics event',
          description: 'Configured earn rules fire from StaaS logistics events with idempotent earn keys.',
        },
        {
          label: 'Latency SLA',
          description: 'Earn visible on member ledger within program p95 SLA after the source event.',
        },
        {
          label: 'No double-earn on retry',
          description: 'Replaying the same logistics event never creates a second earn posting.',
        },
      ],
    },
    {
      title: 'Partner burn and offer eligibility on live state',
      description:
        'As a brand partner manager, I want burn and offer eligibility to use live StaaS member + site state so partners do not reject valid redemptions.',
      criteria: [
        {
          label: 'Partner adapter idempotency',
          description: 'Partner burn APIs use idempotency keys; retries return the original burn result.',
        },
        {
          label: 'Eligibility uses live balances',
          description: 'Offer checks read the loyalty ledger, not a delayed retail extract.',
        },
      ],
    },
    {
      title: 'Returns and ASN corrections adjust loyalty correctly',
      description:
        'As a member experience lead, I want returns and ASN corrections to reverse or adjust earn/burn so balances stay accurate.',
      criteria: [
        {
          label: 'Correction event adjusts ledger',
          description: 'A returns/ASN correction produces a compensating loyalty entry linked to the original earn/burn.',
        },
        {
          label: 'Mismatch rate measurable',
          description: 'Ops can report loyalty_returns_mismatch_rate by program and site.',
        },
      ],
    },
    {
      title: 'Shared site and member identity across logistics and loyalty',
      description:
        'As a StaaS platform owner, I want one site/member identity model so logistics events and loyalty postings never diverge on who/where.',
      criteria: [
        {
          label: 'Canonical IDs',
          description: 'Site and member IDs are shared across logistics and loyalty APIs.',
        },
        {
          label: 'Event catalogue',
          description: 'Documented event types link dock/ASN/receipt/return to earn/burn/adjust.',
        },
      ],
    },
  ]

  for (const story of stories) {
    const storyNode = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('USER_STORY', $1, $2, $3::jsonb) RETURNING id`,
      [
        story.title.slice(0, 120),
        story.description,
        JSON.stringify({ featureId, demo: true, product: 'StaaS' }),
      ],
    )
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'REFINES')`,
      [featureId, storyNode!.id],
    )
    for (const ac of story.criteria) {
      const acNode = await queryOne<{ id: number }>(
        `INSERT INTO graph_nodes (kind, label, description, metadata)
         VALUES ('ACCEPTANCE_CRITERION', $1, $2, $3::jsonb) RETURNING id`,
        [
          ac.label.slice(0, 120),
          ac.description,
          JSON.stringify({ storyId: storyNode!.id, demo: true }),
        ],
      )
      await query(
        `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'ACCEPTS')`,
        [storyNode!.id, acNode!.id],
      )
    }
  }
  console.log(`Seeded ${stories.length} StaaS user stories with acceptance criteria`)
}

async function seedStaasDomain(featureId: number) {
  const concepts = [
    {
      name: 'Logistics inventory snapshot',
      description: 'Near-real-time on-hand by site/SKU for 3PL warehouses on the StaaS logistics profile.',
    },
    {
      name: 'ASN',
      description: 'Advanced shipping notice for inbound stock used in outbound dock planning.',
    },
    {
      name: 'Dock wave plan',
      description: 'Outbound planning unit that consumes live on-hand + ASN from StaaS.',
    },
    {
      name: 'Loyalty member ledger',
      description: 'Authoritative earn/burn/adjust postings for a member on StaaS loyalty management.',
    },
    {
      name: 'Earn event',
      description: 'Idempotent points credit triggered by a logistics or commerce event.',
    },
    {
      name: 'Burn / partner offer',
      description: 'Redemption or partner offer against live member balance and tier.',
    },
    {
      name: 'Site–member identity',
      description: 'Shared identifiers linking 3PL sites, shipments, and loyalty members.',
    },
  ]
  const kpis = [
    {
      name: 'Inventory freshness p95',
      description: 'Age of on-hand snapshots used by dock planning.',
      target: '≤ 5 minutes p95',
    },
    {
      name: 'Dock rework rate',
      description: 'Share of outbound waves requiring recount or trailer rework.',
      target: '↓ 30% in 90 days',
    },
    {
      name: 'Loyalty earn latency p95',
      description: 'Time from source event to member ledger visibility.',
      target: 'Within program SLA (default ≤ 2 min p95)',
    },
    {
      name: 'Loyalty returns mismatch rate',
      description: 'Earn/burn adjustments that disagree with returns/ASN corrections.',
      target: '↓ 40% in 120 days',
    },
  ]
  const regulations = [
    {
      name: 'Member PII and loyalty consent',
      description: 'Loyalty ledger access purpose-limited; consent recorded for partner earn/burn.',
    },
    {
      name: 'Uffizio data-processing agreement',
      description: 'Warehouse inventory and ASN data processed under the Uffizio DPA for logistics purposes.',
    },
  ]
  const rules = [
    {
      name: 'Logistics profile isolation',
      description: 'Logistics sync must not degrade retail store sync latency.',
    },
    {
      name: 'Idempotent loyalty postings',
      description: 'Earn/burn retries with the same key never double-post.',
    },
    {
      name: 'Corrections compensate',
      description: 'Returns/ASN corrections always create linked compensating loyalty entries.',
    },
  ]

  for (const c of concepts) {
    const node = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('DOMAIN_CONCEPT', $1, $2, $3::jsonb) RETURNING id`,
      [c.name, c.description, JSON.stringify({ featureId, demo: true, product: 'StaaS' })],
    )
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'DEFINES')`,
      [featureId, node!.id],
    )
  }
  for (const k of kpis) {
    const node = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('KPI', $1, $2, $3::jsonb) RETURNING id`,
      [k.name, k.description, JSON.stringify({ featureId, target: k.target, demo: true })],
    )
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'DEFINES')`,
      [featureId, node!.id],
    )
  }
  for (const r of regulations) {
    const node = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('REGULATION', $1, $2, $3::jsonb) RETURNING id`,
      [r.name, r.description, JSON.stringify({ featureId, demo: true })],
    )
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'RELATES_TO')`,
      [featureId, node!.id],
    )
  }
  for (const r of rules) {
    const node = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('BUSINESS_RULE', $1, $2, $3::jsonb) RETURNING id`,
      [r.name, r.description, JSON.stringify({ featureId, demo: true })],
    )
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'DEFINES')`,
      [featureId, node!.id],
    )
  }
  console.log('Seeded StaaS domain concepts, KPIs, regulations, and business rules')
}

async function seedStaasArchitecture(featureId: number) {
  const contexts = [
    {
      name: 'Logistics Sync',
      description:
        'Near-real-time warehouse on-hand and ASN ingest for 3PL sites on the StaaS logistics profile; isolates retail sync.',
      interfaces: [
        {
          name: 'PublishInventorySnapshot',
          protocol: 'gRPC',
          description: 'Publish site/SKU on-hand snapshot with freshness timestamp.',
        },
        {
          name: 'IngestAsn',
          protocol: 'HTTP',
          description: 'Ingest ASN from 3PL WMS adapter into StaaS logistics model.',
        },
      ],
    },
    {
      name: 'Dock Planning',
      description: 'Consumes live inventory + ASN for outbound wave planning and rework metrics.',
      dependsOn: ['Logistics Sync'],
      interfaces: [
        {
          name: 'GetDockWaveStock',
          protocol: 'HTTP',
          description: 'Return live on-hand/ASN view for a dock wave plan.',
        },
      ],
    },
    {
      name: 'Loyalty Ledger',
      description: 'Member earn/burn/adjust ledger with tiers; idempotent postings from logistics and partner events.',
      interfaces: [
        {
          name: 'PostEarn',
          protocol: 'HTTP',
          description: 'Post idempotent earn from a logistics or commerce event.',
        },
        {
          name: 'PostBurn',
          protocol: 'HTTP',
          description: 'Post partner/member burn against live balance.',
        },
      ],
    },
    {
      name: 'Loyalty Partners',
      description: 'Partner offer eligibility and burn adapters with retry-safe keys.',
      dependsOn: ['Loyalty Ledger'],
      interfaces: [
        {
          name: 'CheckOfferEligibility',
          protocol: 'HTTP',
          description: 'Evaluate partner offer using live ledger + tier.',
        },
      ],
    },
    {
      name: 'Identity & Events',
      description: 'Shared site/member identity and event catalogue linking logistics to loyalty.',
      dependsOn: ['Logistics Sync', 'Loyalty Ledger'],
      interfaces: [
        {
          name: 'ResolveSiteMember',
          protocol: 'gRPC',
          description: 'Resolve canonical site and member IDs for cross-domain events.',
        },
      ],
    },
  ]

  const ctxIds = new Map<string, number>()
  for (const ctx of contexts) {
    const node = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('BOUNDED_CONTEXT', $1, $2, $3::jsonb) RETURNING id`,
      [ctx.name, ctx.description, JSON.stringify({ featureId, demo: true, product: 'StaaS' })],
    )
    ctxIds.set(ctx.name, node!.id)
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'IMPLEMENTS')`,
      [node!.id, featureId],
    )
  }
  for (const ctx of contexts) {
    const fromId = ctxIds.get(ctx.name)!
    for (const dep of ctx.dependsOn ?? []) {
      const toId = ctxIds.get(dep)
      if (toId) {
        await query(
          `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'DEPENDS_ON')`,
          [fromId, toId],
        )
      }
    }
    for (const iface of ctx.interfaces) {
      const inode = await queryOne<{ id: number }>(
        `INSERT INTO graph_nodes (kind, label, description, metadata)
         VALUES ('SERVICE_INTERFACE', $1, $2, $3::jsonb) RETURNING id`,
        [
          iface.name,
          `${iface.protocol} — ${ctx.name}: ${iface.description}`,
          JSON.stringify({ protocol: iface.protocol, context: ctx.name, featureId, demo: true }),
        ],
      )
      await query(
        `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'IMPLEMENTS')`,
        [inode!.id, fromId],
      )
    }
  }
  console.log(`Seeded ${contexts.length} StaaS bounded contexts with service interfaces`)
}

async function seedStaasBuild(featureId: number) {
  const files = [
    'packages/staas/logistics/inventorySync.ts',
    'packages/staas/logistics/asnIngest.ts',
    'packages/staas/logistics/dockPlanning.ts',
    'packages/staas/loyalty/memberLedger.ts',
    'packages/staas/loyalty/earnBurn.ts',
    'packages/staas/loyalty/partnerAdapters.ts',
    'packages/staas/loyalty/returnsAdjust.ts',
    'packages/staas/identity/siteMember.ts',
    'packages/staas/loyalty/memberLedger.test.ts',
    'packages/staas/logistics/inventorySync.test.ts',
  ]
  const noteText = [
    'Delivery shape for the ~€280–360k StaaS program (12–16 weeks, team of four):',
    '• Logistics Sync — warehouse on-hand + ASN adapters; retail path isolation.',
    '• Dock Planning — live stock consumers + rework metrics.',
    '• Loyalty Ledger — earn/burn/adjust with idempotent keys and tiers.',
    '• Partners — offer eligibility + burn adapters.',
    '• Identity & Events — shared site/member model linking dock/ASN/returns to loyalty.',
    'Risk: multi-WMS ASN variance and partner burn idempotency — pilot soak on one 3PL + one program mandatory.',
  ].join('\n')

  const note = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('IMPLEMENTATION_NOTE', $1, $2, $3::jsonb) RETURNING id`,
    [
      'StaaS 3PL logistics + loyalty changeset (€280–360k)',
      noteText,
      JSON.stringify({ featureId, files, risk: 'high', demo: true, effortCostEur: '280k-360k' }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'IMPLEMENTS')`,
    [note!.id, featureId],
  )
  for (const file of files) {
    const fnode = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('CODE_FILE', $1, $2, $3::jsonb) RETURNING id`,
      [file.slice(0, 120), `Code file: ${file}`, JSON.stringify({ path: file, noteId: note!.id, demo: true })],
    )
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'IMPLEMENTS')`,
      [fnode!.id, featureId],
    )
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'TOUCHES')`,
      [note!.id, fnode!.id],
    )
  }

  const fixtures = [
    { name: 'inventory-freshness-within-sla', status: 'passed' },
    { name: 'retail-sync-unaffected', status: 'passed' },
    { name: 'asn-ingest-maps-wms-vendor', status: 'passed' },
    { name: 'dock-wave-reads-live-stock', status: 'passed' },
    { name: 'earn-from-logistics-event', status: 'passed' },
    { name: 'earn-idempotent-on-retry', status: 'passed' },
    { name: 'burn-partner-adapter-idempotent', status: 'passed' },
    { name: 'returns-correction-compensates-earn', status: 'passed' },
    { name: 'site-member-identity-shared', status: 'passed' },
    { name: 'loyalty-earn-latency-sla', status: 'passed' },
  ]
  const summary =
    'Quality gate clear for StaaS 3PL logistics + loyalty — 10/10 fixtures passed. Covered: inventory freshness, retail isolation, ASN ingest, dock live stock, earn/burn idempotency, returns compensation, shared identity, earn latency SLA.'

  const suite = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('TEST_SUITE', $1, $2, $3::jsonb) RETURNING id`,
    [
      'Suite: StaaS 3PL logistics + loyalty',
      summary,
      JSON.stringify({ featureId, resultCount: fixtures.length, demo: true }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'VERIFIES')`,
    [suite!.id, featureId],
  )
  for (const r of fixtures) {
    const cnode = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('TEST_CASE', $1, $2, $3::jsonb) RETURNING id`,
      [r.name, JSON.stringify(r), JSON.stringify({ status: r.status, severity: 'info', featureId, demo: true })],
    )
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'VERIFIES')`,
      [cnode!.id, suite!.id],
    )
  }
  const run = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('TEST_RUN', $1, $2, $3::jsonb) RETURNING id`,
    [
      'Test run: StaaS 3PL logistics + loyalty',
      JSON.stringify({ results: fixtures, blocked: false, summary }),
      JSON.stringify({
        featureId,
        blocked: false,
        conclusion: 'success',
        passed: fixtures.length,
        failed: 0,
        demo: true,
      }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'VERIFIES')`,
    [run!.id, suite!.id],
  )
  const qaBuild = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('BUILD', $1, $2, $3::jsonb) RETURNING id`,
    [
      'QA build gate: StaaS 3PL logistics + loyalty',
      summary,
      JSON.stringify({
        conclusion: 'success',
        featureId,
        runId: run!.id,
        suiteId: suite!.id,
        source: 'quality-engineering',
        demo: true,
      }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'VERIFIES')`,
    [qaBuild!.id, featureId],
  )

  const docs = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('DOCUMENTATION', $1, $2, $3::jsonb) RETURNING id`,
    [
      'StaaS 3PL logistics + loyalty guide',
      [
        '1. Overview — StaaS hub for 3PL logistics (live inventory/ASN/dock) and loyalty management (earn/burn/tiers/partners); ~€720K–€1.45M/year value; ~€280–360k delivery.',
        '2. Logistics Sync — warehouse on-hand + ASN adapters; logistics profile isolated from retail sync.',
        '3. Dock Planning — consumers read live stock; rework KPIs exposed.',
        '4. Loyalty Ledger — idempotent earn/burn/adjust; tier engine.',
        '5. Partners — offer eligibility and burn adapters with retry-safe keys.',
        '6. Returns & corrections — compensating loyalty entries linked to ASN/receipt corrections.',
        '7. Identity — shared site/member IDs and event catalogue across domains.',
        '8. Ops — pilot soak (one 3PL + one program), freshness and earn latency dashboards, go-live gates.',
      ].join('\n'),
      JSON.stringify({ featureId, demo: true }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'DOCUMENTS')`,
    [docs!.id, featureId],
  )
  const changelog = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('CHANGELOG', $1, $2, $3::jsonb) RETURNING id`,
    [
      'Changelog: StaaS 3PL logistics + loyalty',
      [
        '- Near-real-time warehouse on-hand for 3PL logistics profile',
        '- ASN ingest adapters with freshness contracts',
        '- Dock planning APIs on live stock',
        '- Loyalty member ledger with tiers',
        '- Idempotent earn from logistics events',
        '- Partner burn/offer eligibility adapters',
        '- Returns/ASN corrections → compensating loyalty entries',
        '- Shared site/member identity + event catalogue',
        '- Retail sync isolation tests',
        '- Docs for dual-path ops and GTM packaging',
      ].join('\n'),
      JSON.stringify({ documentationId: docs!.id, featureId, demo: true }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'DOCUMENTS'), ($3,$4,'DOCUMENTS')`,
    [changelog!.id, featureId, changelog!.id, docs!.id],
  )
  console.log('Seeded StaaS implementation, quality gate (passed), and docs')
}

async function seedStaasShipLearn(featureId: number) {
  const cycle = await queryOne<{ id: string }>(
    `SELECT id FROM cycles WHERE feature_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [featureId],
  )
  const gitSha = 'staas-3pl-loyal-e5f6a7b8'
  const runId = 'gha-staas-demo-2002'

  const build = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('BUILD', $1, $2, $3::jsonb) RETURNING id`,
    [
      `Build ${gitSha.slice(0, 8)}`,
      JSON.stringify({ sha: gitSha, runId, conclusion: 'success' }),
      JSON.stringify({ conclusion: 'success', gitSha, runId, featureId, source: 'devops', demo: true }),
    ],
  )
  const iac = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('IAC_CHANGESET', $1, $2, $3::jsonb) RETURNING id`,
    [
      'iac-changeset-staas',
      `IaC changeset for StaaS 3PL + loyalty (${runId})`,
      JSON.stringify({ runId, gitSha, conclusion: 'success', demo: true }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'PRODUCED')`,
    [build!.id, iac!.id],
  )

  const scan = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('SECURITY_SCAN', $1, $2, $3::jsonb) RETURNING id`,
    [
      `Security scan ${gitSha.slice(0, 8)}`,
      JSON.stringify({ sha: gitSha, runId, total: 0, critical: 0, high: 0, status: 'clean' }),
      JSON.stringify({ critical: 0, high: 0, blocking: false, sha: gitSha, featureId, demo: true }),
    ],
  )
  await queryOne(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('COST_ESTIMATE', $1, $2, $3::jsonb) RETURNING id`,
    [
      `Cost estimate ${gitSha.slice(0, 8)}`,
      JSON.stringify({ repoPath: 'packages/staas', gitSha, monthlyCost: 220, threshold: 500 }),
      JSON.stringify({ monthlyCost: 220, threshold: 500, gitSha, repoPath: 'packages/staas', demo: true }),
    ],
  )

  const report = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('READINESS_REPORT', $1, $2, $3::jsonb) RETURNING id`,
    [
      `Readiness report build ${build!.id}`,
      JSON.stringify({
        ready: true,
        approvalSet: ['eng-lead', 'product'],
        buildId: build!.id,
        scanNodeId: scan!.id,
        environment: 'staging',
        featureId,
      }),
      JSON.stringify({ ready: true, approvalSet: ['eng-lead', 'product'], featureId, demo: true }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'BUNDLES'), ($1,$3,'CLEARED_BY')`,
    [report!.id, build!.id, scan!.id],
  )

  for (const role of ['eng-lead', 'product']) {
    const dr = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('DECISION_RECORD', $1, $2, $3::jsonb) RETURNING id`,
      [
        `Release gate: ${role} approve StaaS`,
        JSON.stringify({
          gate: 'RELEASE_GATE',
          decision: 'approve',
          role,
          featureId,
          cycleId: cycle?.id,
        }),
        JSON.stringify({
          gate: 'RELEASE_GATE',
          decision: 'approve',
          role,
          cycleId: cycle?.id,
          featureId,
          demo: true,
        }),
      ],
    )
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'APPROVES')`,
      [dr!.id, featureId],
    )
  }

  const env = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('ENV_TARGET', $1, $2, $3::jsonb) RETURNING id`,
    [
      'production-staas',
      'Environment target: production (StaaS)',
      JSON.stringify({ environment: 'production', demo: true }),
    ],
  )
  const dep = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('DEPLOYMENT', $1, $2, $3::jsonb) RETURNING id`,
    [
      `Deploy ${report!.id} → production (StaaS)`,
      JSON.stringify({ reportId: report!.id, environment: 'production', status: 'deployed' }),
      JSON.stringify({
        status: 'deployed',
        environment: 'production',
        reportId: report!.id,
        featureId,
        demo: true,
      }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'DEPLOYS_TO'), ($3,$1,'DEPLOYS_TO')`,
    [dep!.id, env!.id, report!.id],
  )

  for (const kpi of [
    { label: 'Inventory freshness p95', sli: 0.97 },
    { label: 'Loyalty earn latency p95', sli: 0.96 },
    { label: 'Dock rework rate', sli: 0.94 },
  ]) {
    const obs = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('KPI_OBSERVATION', $1, $2, $3::jsonb) RETURNING id`,
      [
        kpi.label,
        JSON.stringify({
          service: 'staas-hub',
          sliWindow: '7d',
          target: 0.93,
          sli: kpi.sli,
          kpiLabel: kpi.label,
        }),
        JSON.stringify({
          service: 'staas-hub',
          sliWindow: '7d',
          target: 0.93,
          sli: kpi.sli,
          healthy: true,
          kpiLabel: kpi.label,
          featureId,
          demo: true,
        }),
      ],
    )
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'MEASURES')`,
      [obs!.id, dep!.id],
    )
  }

  const verdict = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('HYPOTHESIS_VERDICT', $1, $2, $3::jsonb) RETURNING id`,
    [
      'StaaS logistics + loyalty bets held',
      'Pilot Uffizio site: dock rework −28% in 90 days; loyalty earn p95 inside SLA; returns mismatch −36%. Realized annualised value ~€1.05M vs €720K–€1.45M band.',
      JSON.stringify({ held: true, featureId, demo: true }),
    ],
  )
  void verdict

  for (const o of [
    {
      label: 'Outcome: dock rework down',
      body: 'Outbound wave rework dropped ~28% on the Uffizio design-partner site within 90 days of live StaaS logistics sync.',
    },
    {
      label: 'Outcome: earn latency met',
      body: 'Loyalty earn from dock/ASN events met program p95 SLA; member complaints on late points fell sharply.',
    },
    {
      label: 'Outcome: returns mismatch down',
      body: 'Compensating ledger entries cut returns/ASN mismatch rate ~36% in 120 days.',
    },
  ]) {
    await queryOne(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('OUTCOME', $1, $2, $3::jsonb) RETURNING id`,
      [o.label, o.body, JSON.stringify({ featureId, demo: true })],
    )
  }

  await queryOne(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('IMPACT_ASSESSMENT', $1, $2, $3::jsonb) RETURNING id`,
    [
      'Impact: StaaS hub value realised',
      'Combined logistics + loyalty program delivered inside the EUR value band; delivery cost ~€310k actual vs €280–360k estimate.',
      JSON.stringify({ featureId, demo: true, realizedValueEur: 1050000 }),
    ],
  )
  for (const s of [
    { label: 'Uffizio ops sentiment', body: 'Dock managers report trusting afternoon waves again.' },
    { label: 'Loyalty CS sentiment', body: 'Fewer tickets on late points and broken burns after returns.' },
    { label: 'Partner sentiment', body: 'Partner offer acceptance improved once eligibility used live balances.' },
  ]) {
    await queryOne(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('SENTIMENT', $1, $2, $3::jsonb) RETURNING id`,
      [s.label, s.body, JSON.stringify({ featureId, demo: true })],
    )
  }

  await queryOne(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('LEARNING', $1, $2, $3::jsonb) RETURNING id`,
    [
      'Learning: ship logistics freshness before partner burns',
      'Design partners adopted faster when dock stock was trustworthy first; loyalty partner burns stuck until land-and-expand on live balances. Next cycle: stage partner adapters after logistics soak.',
      JSON.stringify({ featureId, demo: true, domain: 'staas' }),
    ],
  )

  const calib = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('CALIBRATION_RECORD', $1, $2, $3::jsonb) RETURNING id`,
    [
      'Calibration: StaaS annual value',
      JSON.stringify({
        targetAgentId: 'value-engineering:v1',
        kpi: 'annual_value_eur',
        predictedValue: 1085000,
        actualValue: 1050000,
        errorPct: 3.23,
        cycleId: cycle?.id,
        summary: 'StaaS value estimate within 4% of realised annualised impact.',
      }),
      JSON.stringify({
        targetAgentId: 'value-engineering:v1',
        kpi: 'annual_value_eur',
        predictedValue: 1085000,
        actualValue: 1050000,
        errorPct: 3.23,
        featureId,
        cycleId: cycle?.id,
        demo: true,
      }),
    ],
  )
  void calib
  if (cycle?.id) {
    await query(
      `INSERT INTO agent_calibration (agent_id, cycle_id, predicted_value, actual_value, error_pct, kpi)
       VALUES ('value-engineering:v1', $1, 1085000, 1050000, 3.23, 'annual_value_eur')`,
      [cycle.id],
    ).catch(() => null)
  }

  await query(
    `UPDATE graph_nodes
     SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify({ loopClosed: true, cycleClosed: true, stage: 'DONE' }), featureId],
  )
  await queryOne(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('LEARNING', $1, $2, $3::jsonb) RETURNING id`,
    [
      'Loop closed: StaaS 3PL logistics + loyalty',
      'Decide→Define→Build→Ship→Learn complete for StaaS hub program. Lessons fed back to value/effort calibration for the next logistics or loyalty attach.',
      JSON.stringify({ featureId, demo: true, loopClosed: true }),
    ],
  )
  if (cycle?.id) {
    await query(`UPDATE cycles SET current_stage='DONE', updated_at=NOW() WHERE id=$1`, [cycle.id])
  }
  console.log('Seeded StaaS Ship → Learn → loop closed (DONE)')
}
