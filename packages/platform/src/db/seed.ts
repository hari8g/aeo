import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { initPool, query, queryOne } from './pool.js'

const TOLL_PAIN =
  'Toll.OS MLFF events not metered for Bosch MPS ₹5/event revenue'
const TOLL_FEATURE =
  'Toll.OS MLFF orchestration event metering (₹5/event)'

const STAAS_PAIN =
  'StaaS 3PL warehouse inventory lag breaks outbound dock planning'
const STAAS_FEATURE =
  'StaaS 3PL near-real-time warehouse inventory for dock planning'

/** Wipe graph state so the demo board has only the two curated cases. */
async function purgeGraph() {
  await query(`UPDATE cycles SET feature_id = NULL`)
  await query(`UPDATE agent_episodes SET feature_id = NULL, outcome_node_id = NULL`).catch(
    () => null,
  )
  // edges cascade from nodes
  await query(`DELETE FROM graph_nodes`)
  await query(`DELETE FROM cycles`)
  console.log('Purged graph_nodes, edges, and cycles')
}

async function insertPainPoint(
  label: string,
  description: string,
  meta: Record<string, unknown>,
  quotes: string[],
) {
  const row = await queryOne<{ id: number }>(
    `
    INSERT INTO graph_nodes (kind, label, description, metadata, written_by_agent, trace_id)
    VALUES ('PAIN_POINT', $1, $2, $3::jsonb, 'studio-demo', $4)
    RETURNING id
  `,
    [
      label,
      description,
      JSON.stringify({ demo: true, quotes, ...meta }),
      randomUUID(),
    ],
  )

  for (const quote of quotes.slice(0, 3)) {
    await query(
      `
      INSERT INTO graph_nodes (kind, label, description, metadata, written_by_agent, trace_id)
      VALUES ('CUSTOMER_SIGNAL', $1, $2, $3::jsonb, 'studio-demo', $4)
    `,
      [
        quote.slice(0, 80),
        quote,
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
  brief: Record<string, unknown>
  painPointId: number
  product: string
}) {
  const brief = await queryOne<{ id: number }>(
    `
    INSERT INTO graph_nodes (kind, label, description)
    VALUES ('BRIEF', $1, $2)
    RETURNING id
  `,
    [`Brief: ${args.label}`.slice(0, 120), JSON.stringify(args.brief)],
  )

  const feature = await queryOne<{ id: number }>(
    `
    INSERT INTO graph_nodes (kind, label, description, metadata)
    VALUES (
      'FEATURE', $1, $2,
      $3::jsonb
    )
    RETURNING id
  `,
    [
      args.label,
      args.description,
      JSON.stringify({
        stage: 'INTAKE',
        demo: true,
        sentForSizing: true,
        product: args.product,
      }),
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
  description: Record<string, unknown>,
  metadata: Record<string, unknown>,
  edgeKind: 'ESTIMATES' | 'INFORMS',
) {
  const row = await queryOne<{ id: number }>(
    `
    INSERT INTO graph_nodes (kind, label, description, metadata)
    VALUES ($1, $2, $3, $4::jsonb)
    RETURNING id
  `,
    [kind, label, JSON.stringify(description), JSON.stringify({ ...metadata, demo: true })],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,$3)`,
    [row!.id, featureId, edgeKind],
  )
  return row!.id
}

async function ensureCycle(featureId: number, label: string, stage: string) {
  return queryOne<{ id: string }>(
    `
    INSERT INTO cycles (label, workspace_id, current_stage, feature_id, metadata)
    VALUES ($1, 'default', $2, $3, $4::jsonb)
    RETURNING id
  `,
    [label, stage, featureId, JSON.stringify({ featureId, demo: true })],
  )
}

async function seedTollOs(): Promise<number> {
  const painId = await insertPainPoint(
    TOLL_PAIN,
    'On Toll.OS Multi-Lane Free Flow corridors, billable orchestration events — ANPR plate diagnosis, RFID FASTag reads, and LiDAR exception handling — are recorded inconsistently, so Bosch MPS cannot reliably bill the contracted ₹5 per event.',
    {
      importanceScore: 0.96,
      signalCount: 42,
      tags: ['Toll.OS', 'MLFF', 'orchestration'],
      cohorts: ['toll-operator', 'concessionaire'],
      trend: 'growing',
    },
    [
      'We lose thousands of ₹5 events a day when ANPR diagnosis never lands in Toll.OS orchestration.',
      'LiDAR exception-lane events drop before metering — Bosch MPS never invoices those.',
      'RFID FASTag and ANPR must fuse into one billable orchestration event at ₹5.',
    ],
  )

  const featureId = await insertFeature({
    label: TOLL_FEATURE,
    description:
      'Unify ANPR, RFID FASTag, and LiDAR exception events into a single Toll.OS MLFF orchestration ledger that meters ₹5 to Bosch MPS per recorded event.',
    product: 'Toll.OS',
    painPointId: painId,
    brief: {
      title: TOLL_FEATURE,
      problemStatement:
        'Toll.OS under-captures billable MLFF orchestration events from ANPR, RFID FASTag, and LiDAR. Bosch MPS is contracted at ₹5 per recorded event.',
      customerSegment: 'European toll operators & concessionaires on Toll.OS MLFF',
      evidenceSummary: '42 operator signals in 30 days on missed ANPR, dropped LiDAR exceptions, and unfused RFID/ANPR half-events.',
      isDuplicate: false,
      duplicateOf: null,
      recommendation: 'High commercial urgency — metering integrity is the product of Toll.OS for Bosch MPS.',
    },
  })

  const valueId = await insertAssessment(
    featureId,
    'BUSINESS_IMPACT',
    'Business impact: Toll.OS MLFF event metering (₹5/event)',
    {
      executiveSummary:
        'Bosch MPS earns ₹5 for every Toll.OS MLFF orchestration event recorded — ANPR plate diagnosis, RFID FASTag confirmation, and LiDAR exception handling. Closing capture gaps unlocks ₹7.0M–₹11.0M/year in metered platform revenue.',
      valueLow: 7000000,
      valueHigh: 11000000,
      valueCurrency: 'INR',
      valuePeriod: 'year',
      confidence: 68,
      pricingModel: {
        unit: 'event',
        pricePerEventInr: 5,
        eventTypes: [
          'ANPR number-plate diagnosis',
          'RFID FASTag read confirmation',
          'LiDAR exception-lane handling',
        ],
        eventsLow: 1400000,
        eventsHigh: 2200000,
      },
      assumptions: [
        'Contracted Bosch MPS rate remains ₹5 per recorded Toll.OS orchestration event',
        '1.4M–2.2M billable events/year across active Toll.OS MLFF corridors in scope',
        'Fused multi-sensor passages bill once (no RFID+ANPR double charge)',
      ],
      hypotheses: [
        {
          kpi: 'billable_event_capture_rate',
          direction: 'increase',
          magnitudePct: 35,
          timeframeDays: 90,
          attributionMethod: 'before_after',
          rationale: 'Orchestration ledger closes ANPR/RFID/LiDAR drop paths before invoicing',
        },
        {
          kpi: 'unbilled_lidar_exception_events',
          direction: 'decrease',
          magnitudePct: 50,
          timeframeDays: 120,
          attributionMethod: 'before_after',
          rationale: 'LiDAR exceptions always open a Toll.OS workflow that meters ₹5',
        },
      ],
    },
    { valueLow: 7000000, valueHigh: 11000000, confidence: 68, valueCurrency: 'INR' },
    'ESTIMATES',
  )

  const effortId = await insertAssessment(
    featureId,
    'DEV_IMPACT',
    'Engineering estimate: Toll.OS MLFF orchestration metering',
    {
      summary:
        'Sensor-fusion work across ANPR diagnosis, RFID FASTag ingest, LiDAR exception bus, and a Toll.OS ledger that emits billable ₹5 events.',
      effortWeeksLow: 10,
      effortWeeksHigh: 14,
      complexity: 'high',
      technicalRisks: [
        'ANPR and RFID clocks drift under free-flow density',
        'LiDAR exception schemas differ by gantry vendor',
        'Billing ledger must be idempotent at ₹5/event',
      ],
      assumptions: ['Existing Toll.OS event bus can be extended; no gantry firmware rewrite'],
      breakdown: { design: 15, implementation: 40, testing: 25, integration: 15, documentation: 5 },
      recommendedTeamSize: 4,
      applicableRegulations: ['ANPR still retention rules'],
      addressedRiskIndices: [],
      tShirt: 'L',
      storyPoints: 21,
      rationale: 'Multi-sensor fusion + commercial metering on a live MLFF corridor',
    },
    { effortWeeksLow: 10, effortWeeksHigh: 14, complexity: 'high', recommendedTeamSize: 4 },
    'ESTIMATES',
  )

  const gtmId = await insertAssessment(
    featureId,
    'GTM_PROJECTION',
    'GTM: Toll.OS MLFF orchestration metering',
    {
      positioning:
        'Toll.OS turns every ANPR diagnosis, FASTag RFID read, and LiDAR exception into a trusted, billable ₹5 event for Bosch MPS.',
      segments: [
        {
          name: 'National toll concessionaires on MLFF',
          size: 'medium',
          fit: 'high',
          cac: 'medium',
          ltv: 'high',
        },
        {
          name: 'Regional road operators with RFID + ANPR',
          size: 'large',
          fit: 'high',
          cac: 'low',
          ltv: 'high',
        },
      ],
      go_to_market:
        'Lead with corridor pilots that already lose metered revenue — show a 30-day before/after on unbilled LiDAR and ANPR/RFID half-events, then expand with Bosch MPS commercial ops.',
      competitive_differentiation:
        'Competitors sell sensors or back-office tolling; Toll.OS fuses ANPR + RFID + LiDAR into one orchestration ledger priced at ₹5/event.',
      featureId,
    },
    { segmentCount: 2, topSegment: 'National toll concessionaires on MLFF' },
    'INFORMS',
  )

  const cycle = await ensureCycle(featureId, TOLL_FEATURE, 'BUILD')

  for (const h of [
    {
      kpi: 'billable_event_capture_rate',
      direction: 'increase',
      magnitudePct: 35,
      timeframeDays: 90,
      attributionMethod: 'before_after',
      rationale: 'Orchestration ledger closes ANPR/RFID/LiDAR drop paths before invoicing',
    },
    {
      kpi: 'unbilled_lidar_exception_events',
      direction: 'decrease',
      magnitudePct: 50,
      timeframeDays: 120,
      attributionMethod: 'before_after',
      rationale: 'LiDAR exceptions always open a Toll.OS workflow that meters ₹5',
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
       '{"valueScore":78,"riskScore":44,"recommendation":"ADMIT","decision":"admit","demo":true}'::jsonb
     ) RETURNING id`,
    [
      `Decision packet: ${TOLL_FEATURE}`,
      JSON.stringify({
        featureId,
        valueScore: 78,
        riskScore: 44,
        recommendation: 'ADMIT',
        summary:
          'Clear ₹5/event commercial model and strong operator demand — admit Toll.OS MLFF metering into Define.',
        businessAssessmentId: valueId,
        engAssessmentId: effortId,
        projectionId: gtmId,
        decision: 'admit',
        pricingModel: { pricePerEventInr: 5, currency: 'INR' },
      }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES
       ($1,$2,'FUNDED_BY'), ($1,$3,'PACKET_INCLUDES'), ($1,$4,'PACKET_INCLUDES'), ($1,$5,'PACKET_INCLUDES')`,
    [packet!.id, featureId, valueId, effortId, gtmId],
  )

  const rationale =
    'Admit Toll.OS MLFF orchestration metering. At ₹5 per ANPR / RFID FASTag / LiDAR exception event, recovering 1.4M–2.2M under-captured events is the core Bosch MPS commercial outcome for this corridor.'
  const dr = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata, written_by_agent, trace_id)
     VALUES (
       'DECISION_RECORD',
       $1, $2, $3::jsonb, 'human-gate', $4
     ) RETURNING id`,
    [
      `PORTFOLIO_GATE: admit Toll.OS by CPO`,
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

  console.log('Seeded Toll.OS: pain → case → value → effort → GTM → packet → Admit')
  await seedTollOsRequirements(featureId)
  await seedTollOsDomain(featureId)
  await seedTollOsArchitecture(featureId)
  await seedTollOsBuild(featureId)
  await seedTollOsShipLearn(featureId)
  return featureId
}

async function seedTollOsRequirements(featureId: number) {
  const stories: Array<{
    title: string
    description: string
    criteria: Array<{ label: string; description: string }>
  }> = [
    {
      title: 'Meter an ANPR plate diagnosis as a ₹5 Toll.OS event',
      description:
        'As a Bosch MPS commercial operator, I want every successful ANPR number-plate diagnosis on an MLFF gantry recorded as one billable Toll.OS orchestration event at ₹5, so corridor revenue matches sensor activity.',
      criteria: [
        {
          label: 'ANPR success writes one ledger event',
          description:
            'When ANPR returns a plate string above the configured confidence threshold, Toll.OS creates exactly one orchestration event priced at ₹5.',
        },
        {
          label: 'Failed diagnoses do not bill',
          description:
            'When ANPR confidence is below threshold or the read is rejected, no ₹5 event is created until an exception path completes.',
        },
      ],
    },
    {
      title: 'Fuse RFID FASTag with ANPR into one passage event',
      description:
        'As a toll operator, I want a FASTag RFID read and a matching ANPR diagnosis for the same free-flow passage to fuse into a single ₹5 event, so we never double-bill or drop half-events.',
      criteria: [
        {
          label: 'Matching window produces one event',
          description:
            'RFID and ANPR that correlate within the fusion time window yield one Toll.OS event at ₹5, not two.',
        },
        {
          label: 'Orphan RFID opens exception, not a silent drop',
          description:
            'An RFID read without a matching ANPR opens the exception workflow rather than disappearing from the ledger.',
        },
      ],
    },
    {
      title: 'LiDAR exception opens a metered orchestration workflow',
      description:
        'As a roadside ops engineer, I want LiDAR-flagged exceptions (occluded plate, ambiguous lane) to open a Toll.OS workflow that still meters ₹5 when resolved, so dense urban sections stop under-billing.',
      criteria: [
        {
          label: 'LiDAR exception is published to Toll.OS',
          description:
            'Every LiDAR exception event reaches Toll.OS orchestration within the corridor SLA and is visible in the exception queue.',
        },
        {
          label: 'Resolved exception meters ₹5',
          description:
            'When the exception is resolved with a plate or tag attribution, exactly one ₹5 orchestration event is recorded.',
        },
      ],
    },
    {
      title: 'Idempotent ₹5 ledger for retries and replays',
      description:
        'As Bosch MPS billing, I want Toll.OS event IDs to be idempotent under sensor retries and bus replays, so the same passage never invoices ₹5 twice.',
      criteria: [
        {
          label: 'Duplicate sensor payload is ignored',
          description:
            'Replaying the same gantry payload with the same event key does not create a second ₹5 charge.',
        },
        {
          label: 'Invoice export matches ledger count',
          description:
            'Daily invoice export event counts equal distinct Toll.OS orchestration event IDs for the corridor.',
        },
      ],
    },
  ]

  for (const story of stories) {
    const storyNode = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('USER_STORY', $1, $2, $3::jsonb)
       RETURNING id`,
      [
        story.title.slice(0, 120),
        story.description,
        JSON.stringify({ featureId, demo: true, product: 'Toll.OS' }),
      ],
    )
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'REFINES')`,
      [featureId, storyNode!.id],
    )
    for (const ac of story.criteria) {
      const acNode = await queryOne<{ id: number }>(
        `INSERT INTO graph_nodes (kind, label, description, metadata)
         VALUES ('ACCEPTANCE_CRITERION', $1, $2, $3::jsonb)
         RETURNING id`,
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
  console.log(`Seeded ${stories.length} Toll.OS user stories with acceptance criteria`)
}

async function seedTollOsDomain(featureId: number) {
  const concepts = [
    {
      name: 'Toll.OS orchestration event',
      description:
        'A billable ₹5 unit representing one successfully attributed MLFF passage handled by Bosch MPS Toll.OS.',
    },
    {
      name: 'ANPR plate diagnosis',
      description:
        'A number-plate read from a gantry camera with confidence used to open or complete a Toll.OS event.',
    },
    {
      name: 'FASTag RFID read',
      description:
        'An RFID tag observation from the roadside reader that can fuse with ANPR for the same free-flow passage.',
    },
    {
      name: 'LiDAR exception',
      description:
        'A roadside LiDAR-flagged ambiguity (occluded plate, lane conflict) that opens Toll.OS exception orchestration.',
    },
  ]
  const kpis = [
    {
      name: 'Billable events per corridor-day',
      description: 'Count of distinct ₹5 Toll.OS orchestration events invoiced per corridor per day.',
      target: 'Match sensor-attributed passages within 2%',
    },
    {
      name: 'Double-bill rate',
      description: 'Share of passages that produce more than one ₹5 charge after fusion and retries.',
      target: '< 0.1%',
    },
  ]
  const regulations = [
    {
      name: 'Corridor privacy retention',
      description:
        'Plate images and tag payloads retained only for the corridor-agreed window; ledger keeps event IDs, not raw imagery.',
    },
  ]
  const rules = [
    {
      name: '₹5 per successful orchestration event',
      description:
        'Exactly one ₹5 charge when ANPR, fused RFID+ANPR, or a resolved LiDAR exception attributes a passage.',
    },
    {
      name: 'Idempotent event keys',
      description:
        'Sensor retries and bus replays with the same event key must not create a second ₹5 ledger entry.',
    },
  ]

  const conceptIds = new Map<string, number>()
  for (const c of concepts) {
    const node = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('DOMAIN_CONCEPT', $1, $2, $3::jsonb)
       RETURNING id`,
      [c.name, c.description, JSON.stringify({ featureId, demo: true, product: 'Toll.OS' })],
    )
    conceptIds.set(c.name, node!.id)
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'DEFINES')`,
      [featureId, node!.id],
    )
  }
  // Relate fusion concepts
  const eventId = conceptIds.get('Toll.OS orchestration event')
  const anprId = conceptIds.get('ANPR plate diagnosis')
  const rfidId = conceptIds.get('FASTag RFID read')
  if (eventId && anprId) {
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'RELATES_TO')`,
      [anprId, eventId],
    )
  }
  if (eventId && rfidId) {
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'RELATES_TO')`,
      [rfidId, eventId],
    )
  }

  for (const k of kpis) {
    const node = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('KPI', $1, $2, $3::jsonb)
       RETURNING id`,
      [
        k.name,
        k.description,
        JSON.stringify({ featureId, target: k.target, demo: true }),
      ],
    )
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'DEFINES')`,
      [featureId, node!.id],
    )
  }

  for (const r of regulations) {
    const node = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('REGULATION', $1, $2, $3::jsonb)
       RETURNING id`,
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
       VALUES ('BUSINESS_RULE', $1, $2, $3::jsonb)
       RETURNING id`,
      [r.name, r.description, JSON.stringify({ featureId, demo: true })],
    )
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'DEFINES')`,
      [featureId, node!.id],
    )
  }

  console.log('Seeded Toll.OS domain concepts, KPIs, regulations, and business rules')
}

async function seedTollOsArchitecture(featureId: number) {
  const contexts: Array<{
    name: string
    description: string
    dependsOn?: string[]
    interfaces: Array<{ name: string; protocol: string; description: string }>
  }> = [
    {
      name: 'Sensor Fusion',
      description:
        'Correlates ANPR diagnoses, FASTag RFID reads, and LiDAR exceptions for the same free-flow passage.',
      interfaces: [
        {
          name: 'CorrelatePassage',
          protocol: 'gRPC',
          description: 'Fuse RFID + ANPR within the corridor time window into one passage attribution.',
        },
      ],
    },
    {
      name: 'Exception Orchestration',
      description:
        'Owns LiDAR-flagged and orphan-sensor exceptions until a plate or tag attribution is resolved.',
      dependsOn: ['Sensor Fusion'],
      interfaces: [
        {
          name: 'OpenException',
          protocol: 'HTTP',
          description: 'Open a Toll.OS exception workflow from a LiDAR or orphan RFID event.',
        },
      ],
    },
    {
      name: 'Event Metering',
      description:
        'Creates the ₹5 Toll.OS orchestration event once a passage is attributed, including resolved exceptions.',
      dependsOn: ['Sensor Fusion', 'Exception Orchestration'],
      interfaces: [
        {
          name: 'MeterOrchestrationEvent',
          protocol: 'HTTP',
          description: 'Record exactly one ₹5 orchestration event for an attributed passage.',
        },
      ],
    },
    {
      name: 'Billing Ledger',
      description:
        'Idempotent ledger and invoice export for Bosch MPS ₹5/event Toll.OS charges.',
      dependsOn: ['Event Metering'],
      interfaces: [
        {
          name: 'ExportDailyInvoice',
          protocol: 'HTTP',
          description: 'Export distinct orchestration event IDs and ₹5 totals for the corridor day.',
        },
      ],
    },
  ]

  const ctxIds = new Map<string, number>()
  for (const ctx of contexts) {
    const node = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('BOUNDED_CONTEXT', $1, $2, $3::jsonb)
       RETURNING id`,
      [ctx.name, ctx.description, JSON.stringify({ featureId, demo: true, product: 'Toll.OS' })],
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
         VALUES ('SERVICE_INTERFACE', $1, $2, $3::jsonb)
         RETURNING id`,
        [
          iface.name,
          `${iface.protocol} — ${ctx.name}: ${iface.description}`,
          JSON.stringify({
            protocol: iface.protocol,
            context: ctx.name,
            featureId,
            demo: true,
          }),
        ],
      )
      await query(
        `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'IMPLEMENTS')`,
        [inode!.id, fromId],
      )
    }
  }

  console.log(`Seeded ${contexts.length} Toll.OS bounded contexts with service interfaces`)
}

async function seedTollOsBuild(featureId: number) {
  const files = [
    'packages/tollos/fusion/anprRfid.ts',
    'packages/tollos/exceptions/lidarWorkflow.ts',
    'packages/tollos/metering/eventLedger.ts',
    'packages/tollos/metering/eventLedger.test.ts',
  ]
  const noteText =
    'Landed ANPR/RFID fusion, LiDAR exception orchestration, and idempotent ₹5 Toll.OS event metering for Bosch MPS MLFF corridors.'

  const note = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('IMPLEMENTATION_NOTE', $1, $2, $3::jsonb)
     RETURNING id`,
    [
      'Toll.OS ₹5 MLFF metering changeset',
      noteText,
      JSON.stringify({ featureId, files, risk: 'medium', demo: true }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'IMPLEMENTS')`,
    [note!.id, featureId],
  )

  for (const file of files) {
    const fnode = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('CODE_FILE', $1, $2, $3::jsonb)
       RETURNING id`,
      [
        file.slice(0, 120),
        `Code file: ${file}`,
        JSON.stringify({ path: file, noteId: note!.id, demo: true }),
      ],
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
    { name: 'meter-anpr-inr-event', status: 'passed' },
    { name: 'fuse-rfid-anpr-single-event', status: 'passed' },
    { name: 'lidar-exception-resolves-to-meter', status: 'passed' },
    { name: 'idempotent-replay-no-double-bill', status: 'passed' },
  ]
  const summary =
    'All Toll.OS MLFF metering fixtures passed — ANPR ₹5 events, RFID fusion, LiDAR exceptions, and idempotent ledger.'

  const suite = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('TEST_SUITE', $1, $2, $3::jsonb)
     RETURNING id`,
    [
      'Suite: Toll.OS MLFF metering',
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
       VALUES ('TEST_CASE', $1, $2, $3::jsonb)
       RETURNING id`,
      [
        r.name,
        JSON.stringify(r),
        JSON.stringify({ status: r.status, severity: 'info', featureId, demo: true }),
      ],
    )
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'VERIFIES')`,
      [cnode!.id, suite!.id],
    )
  }

  const run = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('TEST_RUN', $1, $2, $3::jsonb)
     RETURNING id`,
    [
      'Test run: Toll.OS MLFF metering',
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
     VALUES ('BUILD', $1, $2, $3::jsonb)
     RETURNING id`,
    [
      'QA build gate: Toll.OS MLFF metering',
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
     VALUES ('DOCUMENTATION', $1, $2, $3::jsonb)
     RETURNING id`,
    [
      'Toll.OS MLFF event metering guide',
      [
        '1. Overview — Bosch MPS meters each attributed MLFF passage as a ₹5 Toll.OS orchestration event.',
        '2. Sensor fusion — ANPR + FASTag RFID within the corridor window produce one event.',
        '3. Exceptions — LiDAR-flagged ambiguities open orchestration until resolved.',
        '4. Ledger — Event keys are idempotent under retries; invoice export matches distinct IDs.',
        '5. Privacy — Raw imagery retained only for the corridor-agreed window.',
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
     VALUES ('CHANGELOG', $1, $2, $3::jsonb)
     RETURNING id`,
    [
      'Changelog: Toll.OS MLFF metering',
      [
        '- Meter successful ANPR diagnoses as ₹5 Toll.OS orchestration events',
        '- Fuse FASTag RFID with ANPR into a single passage event',
        '- Open LiDAR exception workflows that meter ₹5 on resolution',
        '- Enforce idempotent ledger keys so retries never double-bill',
      ].join('\n'),
      JSON.stringify({ documentationId: docs!.id, featureId, demo: true }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'DOCUMENTS')`,
    [changelog!.id, featureId],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'DOCUMENTS')`,
    [changelog!.id, docs!.id],
  )

  console.log('Seeded Toll.OS implementation, quality gate (passed), and docs')
}

async function seedTollOsShipLearn(featureId: number) {
  const cycle = await queryOne<{ id: string }>(
    `SELECT id FROM cycles WHERE feature_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [featureId],
  )
  const gitSha = 'tollos-mlff-a1b2c3d4'
  const runId = 'gha-tollos-demo-1001'

  const build = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('BUILD', $1, $2, $3::jsonb)
     RETURNING id`,
    [
      `Build ${gitSha.slice(0, 8)}`,
      JSON.stringify({ sha: gitSha, runId, conclusion: 'success' }),
      JSON.stringify({
        conclusion: 'success',
        gitSha,
        runId,
        featureId,
        source: 'devops',
        demo: true,
      }),
    ],
  )
  const iac = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('IAC_CHANGESET', $1, $2, $3::jsonb)
     RETURNING id`,
    [
      'iac-changeset',
      `IaC changeset for Toll.OS MLFF metering (${runId})`,
      JSON.stringify({ runId, gitSha, conclusion: 'success', demo: true }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'PRODUCED')`,
    [build!.id, iac!.id],
  )

  const scan = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('SECURITY_SCAN', $1, $2, $3::jsonb)
     RETURNING id`,
    [
      `Security scan ${gitSha.slice(0, 8)}`,
      JSON.stringify({
        sha: gitSha,
        runId,
        total: 0,
        critical: 0,
        high: 0,
        status: 'clean',
      }),
      JSON.stringify({
        critical: 0,
        high: 0,
        blocking: false,
        sha: gitSha,
        featureId,
        demo: true,
      }),
    ],
  )

  const cost = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('COST_ESTIMATE', $1, $2, $3::jsonb)
     RETURNING id`,
    [
      `Cost estimate ${gitSha.slice(0, 8)}`,
      JSON.stringify({
        repoPath: 'packages/tollos',
        gitSha,
        monthlyCost: 180,
        threshold: 500,
      }),
      JSON.stringify({
        monthlyCost: 180,
        threshold: 500,
        gitSha,
        repoPath: 'packages/tollos',
        demo: true,
      }),
    ],
  )
  void cost

  const reportPayload = {
    ready: true,
    approvalSet: ['eng-lead', 'product'],
    buildId: build!.id,
    scanNodeId: scan!.id,
    environment: 'staging',
    featureId,
  }
  const report = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('READINESS_REPORT', $1, $2, $3::jsonb)
     RETURNING id`,
    [
      `Readiness report build ${build!.id}`,
      JSON.stringify(reportPayload),
      JSON.stringify({ ready: true, approvalSet: reportPayload.approvalSet, featureId, demo: true }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'BUNDLES')`,
    [report!.id, build!.id],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'CLEARED_BY')`,
    [report!.id, scan!.id],
  )

  for (const role of ['eng-lead', 'product']) {
    const dr = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('DECISION_RECORD', $1, $2, $3::jsonb)
       RETURNING id`,
      [
        `Release gate: ${role} approve`,
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
     VALUES ('ENV_TARGET', $1, $2, $3::jsonb)
     RETURNING id`,
    ['production', 'Environment target: production', JSON.stringify({ environment: 'production', demo: true })],
  )
  const dep = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('DEPLOYMENT', $1, $2, $3::jsonb)
     RETURNING id`,
    [
      `Deploy ${report!.id} → production`,
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
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'DEPLOYS_TO')`,
    [dep!.id, env!.id],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'DEPLOYS_TO')`,
    [report!.id, dep!.id],
  )

  const kpis = [
    { label: 'Billable events / day', sli: 0.995 },
    { label: 'Double-bill rate', sli: 0.999 },
  ]
  for (const kpi of kpis) {
    const obs = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('KPI_OBSERVATION', $1, $2, $3::jsonb)
       RETURNING id`,
      [
        kpi.label,
        JSON.stringify({
          service: 'tollos-metering',
          sliWindow: '7d',
          target: 0.99,
          sli: kpi.sli,
          kpiLabel: kpi.label,
        }),
        JSON.stringify({
          service: 'tollos-metering',
          sliWindow: '7d',
          target: 0.99,
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
     VALUES ('HYPOTHESIS_VERDICT', $1, $2, $3::jsonb)
     RETURNING id`,
    [
      'Toll.OS metering bet held — revenue within range',
      'Live corridor metrics show ₹5 event metering working: ~1.18M billable events/day and double-bill rate ~0.04%. Realized annual value ~₹9.2M vs predicted mid band.',
      JSON.stringify({
        featureId,
        kpiActuals: {
          'Billable events / day': 1_180_000,
          'Double-bill rate': 0.04,
          'Annual metering revenue ₹M': 9.2,
        },
        demo: true,
      }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'ATTRIBUTES')`,
    [verdict!.id, featureId],
  )
  for (const o of [
    { label: 'Billable events / day: 1180000', kpi: 'Billable events / day', value: 1_180_000 },
    { label: 'Double-bill rate: 0.04%', kpi: 'Double-bill rate', value: 0.04 },
    { label: 'Annual metering revenue ₹M: 9.2', kpi: 'Annual metering revenue ₹M', value: 9.2 },
  ]) {
    const oid = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('OUTCOME', $1, $2, $3::jsonb)
       RETURNING id`,
      [
        o.label,
        `${o.kpi}=${o.value}`,
        JSON.stringify({ kpi: o.kpi, value: o.value, featureId, demo: true }),
      ],
    )
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'REALIZED')`,
      [verdict!.id, oid!.id],
    )
  }

  const assessment = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('IMPACT_ASSESSMENT', $1, $2, $3::jsonb)
     RETURNING id`,
    [
      'Impact assessment Toll.OS MLFF metering',
      'Concessionaires and MPS commercial see invoice fidelity; roadside ops trust LiDAR exception workflows.',
      JSON.stringify({ featureId, stakeholderCount: 3, demo: true }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'IMPACTS')`,
    [assessment!.id, featureId],
  )
  for (const s of [
    {
      stakeholder: 'National toll concessionaire',
      text: 'Corridor invoice finally matches ANPR and FASTag activity.',
      sentiment: 'positive',
    },
    {
      stakeholder: 'Bosch MPS commercial',
      text: 'Revenue recognition on MLFF metering is clean.',
      sentiment: 'positive',
    },
    {
      stakeholder: 'Roadside ops',
      text: 'LiDAR exceptions open workflows and still meter when resolved.',
      sentiment: 'positive',
    },
  ]) {
    const sid = await queryOne<{ id: number }>(
      `INSERT INTO graph_nodes (kind, label, description, metadata)
       VALUES ('SENTIMENT', $1, $2, $3::jsonb)
       RETURNING id`,
      [
        s.stakeholder,
        s.text,
        JSON.stringify({ sentiment: s.sentiment, featureId, demo: true }),
      ],
    )
    await query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'IMPACTS')`,
      [assessment!.id, sid!.id],
    )
  }

  const learning = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('LEARNING', $1, $2, $3::jsonb)
     RETURNING id`,
    [
      'Meter fused RFID+ANPR as one ₹5 event — never two',
      'Fusion window and idempotent ledger keys were the difference between clean invoices and double-bills. Carry this into the next MLFF corridor bet.',
      JSON.stringify({ sourceVerdictIds: [verdict!.id], featureId, demo: true }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'DERIVED_FROM')`,
    [learning!.id, verdict!.id],
  )

  const cal = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('CALIBRATION_RECORD', $1, $2, $3::jsonb)
     RETURNING id`,
    [
      'Calibration value-engineering:v1 / annual_value_eur',
      JSON.stringify({
        targetAgentId: 'value-engineering:v1',
        kpi: 'annual_value_eur',
        predictedValue: 9_000_000,
        actualValue: 9_200_000,
        errorPct: 2.22,
        cycleId: cycle?.id,
      }),
      JSON.stringify({
        targetAgentId: 'value-engineering:v1',
        kpi: 'annual_value_eur',
        predictedValue: 9_000_000,
        actualValue: 9_200_000,
        errorPct: 2.22,
        cycleId: cycle?.id,
        featureId,
        demo: true,
      }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'CALIBRATES')`,
    [cal!.id, featureId],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'UPDATES')`,
    [cal!.id, learning!.id],
  )

  if (cycle?.id) {
    await query(`INSERT INTO agent_calibration (agent_id, cycle_id, predicted_value, actual_value, error_pct, kpi)
                 VALUES ($1,$2,$3,$4,$5,$6)
                 ON CONFLICT DO NOTHING`, [
      'value-engineering:v1',
      cycle.id,
      9_000_000,
      9_200_000,
      2.22,
      'annual_value_eur',
    ]).catch(async () => {
      await query(
        `INSERT INTO agent_calibration (agent_id, cycle_id, predicted_value, actual_value, error_pct, kpi)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        ['value-engineering:v1', cycle.id, 9_000_000, 9_200_000, 2.22, 'annual_value_eur'],
      )
    })
    await query(`UPDATE cycles SET current_stage='DONE', updated_at=NOW() WHERE id=$1`, [cycle.id])
  }

  await query(
    `UPDATE graph_nodes
     SET metadata = COALESCE(metadata,'{}'::jsonb) || $1::jsonb, updated_at=NOW()
     WHERE id=$2`,
    [
      JSON.stringify({
        cycleClosed: true,
        closedAt: Date.now(),
        closedCycleId: cycle?.id,
        loopClosed: true,
      }),
      featureId,
    ],
  )

  const loop = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('LEARNING', $1, $2, $3::jsonb)
     RETURNING id`,
    [
      'Loop closed: Toll.OS MLFF orchestration event metering',
      'Cycle complete. Value calibration (~2% error) and lessons are ready for the next Listen → Decide pass.',
      JSON.stringify({
        featureId,
        cycleId: cycle?.id,
        loopClosed: true,
        feedsListen: true,
        calibrationId: cal!.id,
        demo: true,
      }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'DERIVED_FROM')`,
    [loop!.id, verdict!.id],
  )

  console.log('Seeded Toll.OS Ship → Learn → loop closed (DONE)')
}

async function seedStaas(): Promise<number> {
  const painId = await insertPainPoint(
    STAAS_PAIN,
    'Third-party logistics (3PL) customers on MPS Store-as-a-Service for logistics see warehouse inventory and ASN updates lag 4–12 hours, so outbound dock schedules are built on stale stock.',
    {
      importanceScore: 0.78,
      signalCount: 16,
      tags: ['StaaS', '3PL', 'logistics'],
      cohorts: ['3pl', 'logistics'],
      trend: 'growing',
    },
    [
      "Our 3PL StaaS inventory is still yesterday's when we release the afternoon dock wave.",
      'Need near-real-time StaaS stock for logistics warehouses, not retail store sync.',
    ],
  )

  const featureId = await insertFeature({
    label: STAAS_FEATURE,
    description:
      'Deliver near-real-time warehouse inventory and ASN visibility for 3PL logistics sites on MPS StaaS so outbound dock planning uses live stock.',
    product: 'StaaS',
    painPointId: painId,
    brief: {
      title: STAAS_FEATURE,
      problemStatement:
        '3PL logistics warehouses on MPS StaaS cannot trust inventory for outbound dock waves because ASN and on-hand sync lag by half a shift.',
      customerSegment: 'European 3PL logistics operators on MPS StaaS',
      evidenceSummary: '16 warehouse / 3PL signals citing dock rework from stale StaaS counts.',
      isDuplicate: false,
      duplicateOf: null,
      recommendation: 'Focused logistics StaaS — worth admitting after Toll.OS metering.',
    },
  })

  const valueId = await insertAssessment(
    featureId,
    'BUSINESS_IMPACT',
    'Business impact: StaaS 3PL warehouse inventory',
    {
      executiveSummary:
        'Faster StaaS inventory for 3PL docks reduces load rework and missed SLAs — estimated €420K–€980K/year for mid-size European 3PL sites.',
      valueLow: 420000,
      valueHigh: 980000,
      valueCurrency: 'EUR',
      valuePeriod: 'year',
      confidence: 55,
      assumptions: [
        'Assumes 12 mid-size 3PL warehouses adopt near-real-time StaaS sync',
        'Assumes dock rework cost averages €180 per mis-planned trailer',
      ],
      hypotheses: [
        {
          kpi: 'dock_rework_rate',
          direction: 'decrease',
          magnitudePct: 30,
          timeframeDays: 90,
          attributionMethod: 'before_after',
          rationale: 'Live ASN/on-hand removes morning recount cycles',
        },
      ],
    },
    { valueLow: 420000, valueHigh: 980000, confidence: 55, valueCurrency: 'EUR' },
    'ESTIMATES',
  )

  const effortId = await insertAssessment(
    featureId,
    'DEV_IMPACT',
    'Engineering estimate: StaaS 3PL warehouse inventory',
    {
      summary:
        'Moderate work — tighten StaaS sync for warehouse/ASN feeds and expose live stock to dock planning, without retail POS surfaces.',
      effortWeeksLow: 5,
      effortWeeksHigh: 8,
      complexity: 'medium',
      technicalRisks: [
        'ASN publishers vary by 3PL WMS',
        'Peak dock windows amplify sync lag visibility',
      ],
      assumptions: ['Reuse existing StaaS inventory service; logistics profiles only'],
      breakdown: { design: 15, implementation: 45, testing: 25, integration: 10, documentation: 5 },
      recommendedTeamSize: 2,
      applicableRegulations: [],
      addressedRiskIndices: [],
      tShirt: 'M',
      storyPoints: 8,
      rationale: 'Logistics-scoped StaaS sync, not a retail rebuild',
    },
    { effortWeeksLow: 5, effortWeeksHigh: 8, complexity: 'medium', recommendedTeamSize: 2 },
    'ESTIMATES',
  )

  const gtmId = await insertAssessment(
    featureId,
    'GTM_PROJECTION',
    'GTM: StaaS 3PL warehouse inventory',
    {
      positioning:
        'MPS StaaS for logistics — live warehouse stock that outbound dock planners can trust, not a retail store sync.',
      segments: [
        {
          name: 'European 3PL warehouse operators',
          size: 'large',
          fit: 'high',
          cac: 'medium',
          ltv: 'high',
        },
        {
          name: 'Shippers co-located in 3PL hubs',
          size: 'medium',
          fit: 'medium',
          cac: 'medium',
          ltv: 'medium',
        },
      ],
      go_to_market:
        'Start with 3PL sites already on MPS StaaS that report morning dock rework — pilot live ASN/on-hand for one wave, then expand site-by-site.',
      competitive_differentiation:
        'Generic WMS sync exists; StaaS logistics packaging ties inventory lag to dock SLA language 3PL buyers already use.',
      featureId,
    },
    { segmentCount: 2, topSegment: 'European 3PL warehouse operators' },
    'INFORMS',
  )

  const cycle = await ensureCycle(featureId, STAAS_FEATURE, 'PORTFOLIO_GATE')

  const hyp = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('VALUE_HYPOTHESIS', $1, $2, $3::jsonb) RETURNING id`,
    [
      'Bet: dock_rework_rate',
      JSON.stringify({
        kpi: 'dock_rework_rate',
        direction: 'decrease',
        magnitudePct: 30,
        timeframeDays: 90,
        attributionMethod: 'before_after',
        rationale: 'Live ASN/on-hand removes morning recount cycles',
      }),
      JSON.stringify({ committed: false, cycleId: cycle!.id, demo: true }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'SUPPORTS')`,
    [hyp!.id, valueId],
  )

  const packet = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES (
       'PORTFOLIO_PACKET', $1, $2,
       '{"valueScore":64,"riskScore":32,"recommendation":"ADMIT","demo":true}'::jsonb
     ) RETURNING id`,
    [
      `Decision packet: ${STAAS_FEATURE}`,
      JSON.stringify({
        featureId,
        valueScore: 64,
        riskScore: 32,
        recommendation: 'ADMIT',
        summary:
          'Clear 3PL dock pain, moderate effort, strong fit — ready for steering committee Admit / Defer / Reject.',
        businessAssessmentId: valueId,
        engAssessmentId: effortId,
        projectionId: gtmId,
        decision: null,
      }),
    ],
  )
  await query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES
       ($1,$2,'FUNDED_BY'), ($1,$3,'PACKET_INCLUDES'), ($1,$4,'PACKET_INCLUDES'), ($1,$5,'PACKET_INCLUDES')`,
    [packet!.id, featureId, valueId, effortId, gtmId],
  )

  console.log('Seeded StaaS 3PL: pain → case → value → effort → GTM → packet (awaiting decision)')
  return featureId
}

async function seed() {
  await initPool()
  const passwordHash = await bcrypt.hash('demo1234', 10)
  await query(
    `
    INSERT INTO studio_users (email, name, role, password_hash) VALUES
      ('hariprasad@bosch-mps.com', 'Hariprasad', 'admin', $1),
      ('pradeep.r@bosch-mps.com', 'Pradeep R', 'viewer', $1)
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      role = EXCLUDED.role,
      password_hash = EXCLUDED.password_hash
  `,
    [passwordHash],
  )
  await query(
    `DELETE FROM studio_users WHERE email IN ('sarah@yourcompany.com', 'raj@yourcompany.com', 'anita@yourcompany.com')`,
  ).catch(() => null)
  console.log('Seeded 2 studio users — password for all: demo1234')

  await purgeGraph()
  await seedTollOs()
  await seedStaas()

  const admin = await queryOne<{ id: string }>(
    `SELECT id FROM studio_users WHERE email='hariprasad@bosch-mps.com'`,
  )
  if (admin) {
    await query(`DELETE FROM studio_approvers`)
    await query(`INSERT INTO studio_approvers (user_id, title) VALUES ($1,'CPO')`, [admin.id])
    console.log('Seeded portfolio approver (Hariprasad as CPO)')
  }

  console.log('Demo ready: 1 Toll.OS (Admitted) + 1 StaaS 3PL (Awaiting decision)')
  process.exit(0)
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
