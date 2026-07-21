import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { initPool, query, queryOne } from './pool.js'
import { seedStaas, STAAS_FEATURE } from './seedStaas.js'

const TOLL_PAIN =
  'Toll.OS MLFF events not metered for Bosch MPS ₹5/event revenue'
const TOLL_FEATURE =
  'Toll.OS complete MLFF OS — ₹5/event orchestration metering'

/** Wipe graph + log tables so only the two curated demo cases remain. */
async function purgeGraph() {
  await query(`UPDATE cycles SET feature_id = NULL`).catch(() => null)
  await query(`UPDATE agent_episodes SET feature_id = NULL, outcome_node_id = NULL`).catch(
    () => null,
  )
  await query(`TRUNCATE TABLE audit_log RESTART IDENTITY CASCADE`).catch(() => null)
  await query(`TRUNCATE TABLE agent_episodes RESTART IDENTITY CASCADE`).catch(() => null)
  await query(`TRUNCATE TABLE agent_calibration RESTART IDENTITY CASCADE`).catch(() => null)
  await query(`DELETE FROM graph_nodes`)
  await query(`DELETE FROM cycles`)
  console.log('Purged graph, cycles, audit_log, agent_episodes, agent_calibration')
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
      'Build the complete Toll.OS MLFF operating system for Bosch MPS: sensor fusion (ANPR + FASTag RFID + LiDAR exceptions), exception orchestration, ₹5/event metering, idempotent billing ledger, and operator reconciliation — the system of record for free-flow corridor revenue.',
    product: 'Toll.OS',
    painPointId: painId,
    brief: {
      title: TOLL_FEATURE,
      problemStatement: [
        'On Toll.OS Multi-Lane Free Flow (MLFF) corridors, Bosch MPS is contracted to bill ₹5 for every successfully attributed orchestration event — an ANPR plate diagnosis, a FASTag RFID confirmation, or a resolved LiDAR exception. Today those events do not land cleanly in one ledger — Toll.OS is not yet a complete OS for MLFF metering.',
        'ANPR reads often never reach Toll.OS orchestration, so plates that were diagnosed at the gantry generate no invoice line. FASTag RFID and ANPR for the same free-flow passage are not fused, creating either double charges or silent half-events. LiDAR-flagged exceptions (occluded plates, ambiguous lanes) frequently drop before a workflow opens, so dense urban sections systematically under-bill.',
        'The commercial result is a growing gap between sensor activity and metered ₹5 revenue: operators cannot reconcile corridor invoices to roadside reality, and Bosch MPS cannot defend contracted event volumes. Building the complete OS — fusion, exceptions, metering, ledger, reconciliation — is required for Toll.OS to be the system of record for MLFF.',
      ].join('\n\n'),
      customerSegment: [
        'Primary: national / major regional toll concessionaires and operators already running Toll.OS on MLFF (ops, revenue assurance, roadside engineering).',
        'Secondary: Bosch MPS commercial and billing teams who invoice at ₹5 per recorded orchestration event and must defend event counts.',
        'Tertiary: corridor integrators and systems partners who wire ANPR cameras, FASTag RFID readers, and LiDAR exception feeds into Toll.OS.',
      ].join(' '),
      evidenceSummary: [
        '42 corridor / operator signals in the last 30 days specifically cite missed ANPR diagnoses, dropped LiDAR exceptions, and unfused RFID+ANPR half-events.',
        'Representative voice: “We lose thousands of ₹5 events a day when ANPR diagnosis never lands in Toll.OS orchestration.” Roadside teams report LiDAR exception-lane events disappearing before metering. Revenue teams insist RFID FASTag and ANPR must fuse into one billable ₹5 event — never two, never zero.',
        'Trend is growing: denser urban MLFF sections show higher exception rates and larger invoice gaps. Importance score 0.96; cohorts tagged Toll.OS / MLFF / orchestration / concessionaire.',
        'Implication: recovering under-captured events at ₹5 underpins the €1.5–2.0M/year value band from 2027 — metering integrity is the product.',
      ].join('\n\n'),
      isDuplicate: false,
      duplicateOf: null,
      recommendation: [
        'Admit Toll.OS complete MLFF OS metering into Define immediately. The commercial model (₹5/event) is clear, operator demand is explicit, and the technical work — sensor fusion, exception orchestration, and an idempotent ledger — is bounded enough to size and schedule.',
        'Prioritize three outcomes before architecture: (1) every successful ANPR diagnosis meters exactly once at ₹5; (2) matching RFID+ANPR in the fusion window produce one event, not two; (3) LiDAR exceptions open a workflow that still meters ₹5 when resolved, with replay-safe event keys so retries never double-bill.',
        'Defer only if corridor instrumentation is not yet live; otherwise this is the highest-urgency Bosch MPS Toll.OS bet on the board and should clear Portfolio Review into Requirements.',
      ].join('\n\n'),
    },
  })

  const valueId = await insertAssessment(
    featureId,
    'BUSINESS_IMPACT',
    'Business impact: Toll.OS MLFF event metering (₹5/event)',
    {
      executiveSummary:
        'Recovering under-captured Toll.OS MLFF orchestration events (still priced at ₹5/event to Bosch MPS) is worth about €1.5–€2.0 million per year once corridors are fully metered. Value is modelled to land from calendar year 2027 after fusion, exception workflows, and the idempotent ledger roll out — not as a same-year spike.',
      valueLow: 1500000,
      valueHigh: 2000000,
      valueCurrency: 'EUR',
      valuePeriod: 'year',
      valueStartYear: 2027,
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
        note: 'Unit price remains ₹5/event; EUR band is recovered portfolio value at corridor mix / FX.',
      },
      assumptions: [
        'Annual value band is €1.5M–€2.0M once metering integrity is live on in-scope MLFF corridors.',
        'Cash impact starts in calendar year 2027 after rollout and operator acceptance — 2026 is build and pilot.',
        'Contracted Bosch MPS rate remains ₹5 per recorded Toll.OS orchestration event.',
        'Fused multi-sensor passages bill once (no RFID+ANPR double charge).',
      ],
      hypotheses: [
        {
          kpi: 'billable_mlff_orchestration_events',
          direction: 'increase',
          magnitudePct: 18,
          timeframeDays: 180,
          attributionMethod: 'before_after',
          rationale:
            'Closing ANPR landings, RFID+ANPR fusion, and LiDAR exception metering lifts recorded billable events into the €1.5M–€2.0M/year band from 2027.',
        },
        {
          kpi: 'invoice_to_roadside_reconciliation_gap',
          direction: 'decrease',
          magnitudePct: 40,
          timeframeDays: 120,
          attributionMethod: 'before_after',
          rationale:
            'A single idempotent ledger lets concessionaires reconcile corridor invoices to gantry activity.',
        },
      ],
    },
    {
      valueLow: 1500000,
      valueHigh: 2000000,
      confidence: 68,
      valueCurrency: 'EUR',
      valueStartYear: 2027,
    },
    'ESTIMATES',
  )

  const effortId = await insertAssessment(
    featureId,
    'DEV_IMPACT',
    'Engineering estimate: Toll.OS MLFF orchestration metering',
    {
      summary:
        'Sensor-fusion work across ANPR diagnosis, RFID FASTag ingest, LiDAR exception bus, and a Toll.OS ledger that emits billable ₹5 events. Fully loaded delivery ~€350k–€400k over 16–20 weeks with a team of five.',
      effortWeeksLow: 16,
      effortWeeksHigh: 20,
      effortCostLow: 350000,
      effortCostHigh: 400000,
      effortCostCurrency: 'EUR',
      complexity: 'high',
      technicalRisks: [
        'ANPR and RFID clocks drift under free-flow density — fusion must tolerate gantry skew without double-billing',
        'LiDAR exception schemas differ by gantry vendor',
        'Billing ledger must be idempotent at ₹5/event across replays and late RFID',
        'Corridor pilot soak needed before commercial go-live on under-metered urban sections',
      ],
      assumptions: [
        'Existing Toll.OS event bus can be extended; no gantry firmware rewrite',
        'Cost model ~€3.8k–€4.2k fully loaded per person-week × team of five × 16–20 weeks → €350k–€400k',
      ],
      workstreams: [
        'Idempotent ₹5 event ledger',
        'ANPR landing guarantees',
        'RFID+ANPR fusion',
        'LiDAR exception → billable event',
        'Operator reconciliation + MPS billing handoff',
      ],
      breakdown: { design: 15, implementation: 38, testing: 22, integration: 18, documentation: 7 },
      recommendedTeamSize: 5,
      applicableRegulations: ['ANPR still retention rules'],
      addressedRiskIndices: [],
      tShirt: 'L',
      storyPoints: 34,
      rationale: 'Multi-sensor fusion + commercial metering on a live MLFF corridor (~€350–400k)',
    },
    {
      effortWeeksLow: 16,
      effortWeeksHigh: 20,
      effortCostLow: 350000,
      effortCostHigh: 400000,
      effortCostCurrency: 'EUR',
      complexity: 'high',
      recommendedTeamSize: 5,
    },
    'ESTIMATES',
  )

  const gtmId = await insertAssessment(
    featureId,
    'GTM_PROJECTION',
    'GTM: Toll.OS MLFF orchestration metering',
    {
      positioning:
        'Toll.OS is the system of record that turns every successful ANPR diagnosis, FASTag RFID confirmation, and resolved LiDAR exception into one trusted, billable orchestration event for Bosch MPS. We sell metering integrity — recover under-captured events into a €1.5M–€2.0M annual value band from 2027 after a €350k–€400k delivery investment.',
      segments: [
        {
          name: 'National toll concessionaires on MLFF',
          size: 'medium',
          fit: 'high',
          cac: 'medium',
          ltv: 'high',
          description:
            'Ops, revenue assurance, and roadside engineering at national / major regional concessionaires already running Toll.OS on free-flow corridors. They feel invoice gaps daily and co-own the ₹5/event commercial model with Bosch MPS.',
          cacLowEur: 140000,
          cacHighEur: 180000,
          cacNotes:
            'Fully loaded cost to win one national program: ~€50–70k pre-sales & solution architecture, ~€60–80k funded corridor pilot / integration support, ~€20–30k legal, travel, and RFP response. Midpoint ≈ €160k CAC per logo.',
          ltvLowEur: 1800000,
          ltvHighEur: 2500000,
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
          cacLowEur: 45000,
          cacHighEur: 70000,
          cacNotes: 'Land-and-expand on existing MPS relationships → mid CAC ≈ €55k per corridor pack.',
          ltvLowEur: 600000,
          ltvHighEur: 950000,
          ltvNotes: '€120–190k ARR per expansion corridor over 4–5 years → mid LTV ≈ €750k.',
          paybackMonthsLow: 6,
          paybackMonthsHigh: 8,
          paybackNotes: 'Year-1 contribution ~€90–110k → payback 6–8 months.',
          ltvCacRatio: '11–17×',
        },
      ],
      go_to_market:
        '1) Prove on a bleeding corridor with a 30-day before/after on unbilled events.\n\n2) Convert pilot → Toll.OS metering integrity program with MPS commercial ops for 2027 value.\n\n3) Expand to regional RFID+ANPR operators with fixed integration playbooks (CAC €45–70k).\n\n4) Arm sales with LTV:CAC ≥ 11× and ~10-month national payback vs €350–400k delivery.',
      competitive_differentiation:
        'Sensor vendors sell devices; classic back-offices invoice trips. Toll.OS fuses ANPR + RFID + LiDAR into one idempotent ₹5 orchestration event Bosch MPS can defend — metering integrity at event grain.',
      economics: {
        currency: 'EUR',
        valueBandLow: 1500000,
        valueBandHigh: 2000000,
        valueStartYear: 2027,
        deliveryCostLow: 350000,
        deliveryCostHigh: 400000,
        blendedCacLow: 90000,
        blendedCacHigh: 160000,
        blendedLtvLow: 900000,
        blendedLtvHigh: 2500000,
        paybackMonthsLow: 8,
        paybackMonthsHigh: 11,
        ltvCacRatio: '10–16×',
        narrative:
          'National design-partner corridor plus regional expansion. Blended CAC €90–160k vs LTV €0.9–2.5M (10–16×). Payback 8–11 months. Delivery €350–400k recovers in under a quarter of steady-state 2027 annual value.',
      },
      featureId,
    },
    {
      segmentCount: 2,
      topSegment: 'National toll concessionaires on MLFF',
      paybackMonthsLow: 8,
      paybackMonthsHigh: 11,
      blendedCacLow: 90000,
      blendedCacHigh: 160000,
    },
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
      description: [
        'As a Bosch MPS commercial operator, I want every successful ANPR number-plate diagnosis on an MLFF gantry recorded as one billable Toll.OS orchestration event at ₹5, so corridor revenue matches sensor activity and underpins the €1.5–2.0M/year recovered-value case from 2027.',
        'Scope includes confidence-threshold gating, event-key generation from gantry+timestamp+plate hash, and handoff into the Billing Ledger without requiring a matching RFID when ANPR alone is authoritative.',
      ].join('\n\n'),
      criteria: [
        {
          label: 'ANPR success writes one ledger event',
          description:
            'When ANPR returns a plate string above the configured confidence threshold, Toll.OS creates exactly one orchestration event priced at ₹5 within the corridor metering SLA, with a stable event key visible in the ledger.',
        },
        {
          label: 'Failed diagnoses do not bill',
          description:
            'When ANPR confidence is below threshold or the read is rejected, no ₹5 event is created until an exception path (LiDAR / manual) completes with attribution.',
        },
        {
          label: 'Latency within corridor SLA',
          description:
            'From ANPR success callback to ledger persist is within the corridor-configured SLA (default ≤ 2s p95) so free-flow density does not backlog billing.',
        },
      ],
    },
    {
      title: 'Fuse RFID FASTag with ANPR into one passage event',
      description: [
        'As a toll operator, I want a FASTag RFID read and a matching ANPR diagnosis for the same free-flow passage to fuse into a single ₹5 event, so we never double-bill or drop half-events.',
        'Fusion must tolerate gantry clock skew, lane ambiguity, and late RFID arrivals inside the corridor fusion window without creating two charges.',
      ].join('\n\n'),
      criteria: [
        {
          label: 'Matching window produces one event',
          description:
            'RFID and ANPR that correlate within the fusion time window yield one Toll.OS event at ₹5, not two — verified by invoice export distinct IDs.',
        },
        {
          label: 'Orphan RFID opens exception, not a silent drop',
          description:
            'An RFID read without a matching ANPR opens the exception workflow rather than disappearing from the ledger or auto-billing without attribution.',
        },
        {
          label: 'Clock-skew tolerant match',
          description:
            'When gantry clocks differ within the configured skew budget, fusion still attributes one passage; beyond skew, both sides open exception rather than double-bill.',
        },
      ],
    },
    {
      title: 'LiDAR exception opens a metered orchestration workflow',
      description: [
        'As a roadside ops engineer, I want LiDAR-flagged exceptions (occluded plate, ambiguous lane) to open a Toll.OS workflow that still meters ₹5 when resolved, so dense urban sections stop under-billing.',
        'Vendor schema differences must map into a common exception envelope; unresolved exceptions remain visible to ops with aging SLAs.',
      ].join('\n\n'),
      criteria: [
        {
          label: 'LiDAR exception is published to Toll.OS',
          description:
            'Every LiDAR exception event reaches Toll.OS orchestration within the corridor SLA and is visible in the exception queue with vendor, gantry, and reason codes.',
        },
        {
          label: 'Resolved exception meters ₹5',
          description:
            'When the exception is resolved with a plate or tag attribution, exactly one ₹5 orchestration event is recorded and linked to the exception ID.',
        },
        {
          label: 'Aging and escalation',
          description:
            'Exceptions past the corridor aging threshold escalate to ops dashboards; abandoned exceptions never silently convert to billable events.',
        },
      ],
    },
    {
      title: 'Idempotent ₹5 ledger for retries and replays',
      description: [
        'As Bosch MPS billing, I want Toll.OS event IDs to be idempotent under sensor retries and bus replays, so the same passage never invoices ₹5 twice.',
        'This is a hard commercial constraint: LTV and payback models assume one charge per attributed passage.',
      ].join('\n\n'),
      criteria: [
        {
          label: 'Duplicate sensor payload is ignored',
          description:
            'Replaying the same gantry payload with the same event key does not create a second ₹5 charge; the original event ID is returned.',
        },
        {
          label: 'Invoice export matches ledger count',
          description:
            'Daily invoice export event counts equal distinct Toll.OS orchestration event IDs for the corridor day.',
        },
        {
          label: 'Late RFID after ANPR does not double-bill',
          description:
            'A late RFID that fuses to an already-metered ANPR updates attribution metadata only — no second ₹5 line.',
        },
      ],
    },
    {
      title: 'Operator reconciliation view for corridor invoices',
      description:
        'As a concessionaire revenue-assurance lead, I want a Toll.OS reconciliation view that ties roadside attributions (ANPR / RFID / LiDAR) to invoice lines, so I can defend the €1.5–2.0M value case and close disputes without spreadsheets.',
      criteria: [
        {
          label: 'Drill from invoice line to sensors',
          description:
            'Each invoice line links to the orchestration event and underlying sensor evidence references (not raw PII beyond retention policy).',
        },
        {
          label: 'Gap report for under-metered hours',
          description:
            'Ops can list hours where sensor activity exceeds metered events beyond the 2% KPI band.',
        },
      ],
    },
    {
      title: 'Privacy-safe retention for plate imagery',
      description:
        'As a compliance owner, I want raw plate imagery and tag payloads retained only for the corridor-agreed window while the ledger keeps durable event IDs, so metering remains auditable without retaining unnecessary PII.',
      criteria: [
        {
          label: 'Imagery TTL enforced',
          description:
            'Raw imagery is purged or anonymised at the corridor retention boundary; ledger event IDs remain for invoice audit.',
        },
        {
          label: 'Purpose limitation',
          description:
            'Access to residual imagery is purpose-logged and limited to exception resolution and dispute handling.',
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
        'A billable ₹5 unit representing one successfully attributed MLFF passage handled by Bosch MPS Toll.OS. Portfolio value (€1.5–2.0M/year from 2027) is the recovered count of these events across in-scope corridors.',
    },
    {
      name: 'ANPR plate diagnosis',
      description:
        'A number-plate read from a gantry camera with confidence score, timestamp, lane, and gantry ID. Above threshold it can alone create an orchestration event; below threshold it feeds exception paths.',
    },
    {
      name: 'FASTag RFID read',
      description:
        'An RFID tag observation from the roadside reader (tag ID, antenna, RSSI, timestamp) that can fuse with ANPR for the same free-flow passage inside the fusion window.',
    },
    {
      name: 'LiDAR exception',
      description:
        'A roadside LiDAR-flagged ambiguity (occluded plate, lane conflict, multi-vehicle blob) that opens Toll.OS exception orchestration until plate/tag attribution is resolved.',
    },
    {
      name: 'Fusion window',
      description:
        'Corridor-configured time (and optional spatial) envelope in which RFID and ANPR observations are considered the same passage. Must absorb gantry clock skew without double-billing.',
    },
    {
      name: 'Event key',
      description:
        'Idempotency key derived from corridor, gantry, time bucket, and attribution identity. Retries and bus replays with the same key never create a second ₹5 charge.',
    },
    {
      name: 'Reconciliation view',
      description:
        'Operator-facing join of roadside attributions to invoice lines used for revenue assurance and dispute defence.',
    },
  ]
  const kpis = [
    {
      name: 'Billable events per corridor-day',
      description:
        'Count of distinct ₹5 Toll.OS orchestration events invoiced per corridor per day — primary input to the €1.5–2.0M annual value model.',
      target: 'Match sensor-attributed passages within 2%',
    },
    {
      name: 'Double-bill rate',
      description: 'Share of passages that produce more than one ₹5 charge after fusion and retries.',
      target: '< 0.1%',
    },
    {
      name: 'Exception resolution time (p95)',
      description: 'Time from LiDAR/orphan exception open to attribution or controlled abandon.',
      target: '≤ 15 minutes p95 on pilot corridor',
    },
    {
      name: 'Invoice-to-roadside gap',
      description: 'Hours where sensor activity exceeds metered events beyond the capture KPI band.',
      target: '↓ 40% within 120 days of go-live',
    },
  ]
  const regulations = [
    {
      name: 'Corridor privacy retention',
      description:
        'Plate images and tag payloads retained only for the corridor-agreed window; ledger keeps event IDs and non-imagery attribution metadata for invoice audit.',
    },
    {
      name: 'Operator data-processing agreement',
      description:
        'Plate/RFID identifiers processed under the concessionaire DPA; Toll.OS purpose-limits access to metering, exception resolution, and dispute handling.',
    },
  ]
  const rules = [
    {
      name: '₹5 per successful orchestration event',
      description:
        'Exactly one ₹5 charge when ANPR, fused RFID+ANPR, or a resolved LiDAR exception attributes a passage. Never two, never zero for a successful attribution.',
    },
    {
      name: 'Idempotent event keys',
      description:
        'Sensor retries and bus replays with the same event key must not create a second ₹5 ledger entry; late RFID updates metadata only.',
    },
    {
      name: 'Orphans escalate, never silent-drop',
      description:
        'RFID without ANPR, or LiDAR without attribution, must open an exception workflow — never disappear from metering visibility.',
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
      description: [
        'Correlates ANPR diagnoses, FASTag RFID reads, and LiDAR hints for the same free-flow passage inside the corridor fusion window.',
        'Owns clock-skew budgets, match scoring, and the decision to emit a single attribution vs open an orphan path. Primary complexity driver in the €350–400k delivery estimate.',
      ].join(' '),
      interfaces: [
        {
          name: 'CorrelatePassage',
          protocol: 'gRPC',
          description:
            'Fuse RFID + ANPR within the corridor time window into one passage attribution; return match confidence and event-key candidates.',
        },
        {
          name: 'IngestAnprDiagnosis',
          protocol: 'gRPC',
          description:
            'Accept ANPR plate, confidence, gantry, lane, and timestamp; enqueue for fusion or direct metering when ANPR-authoritative.',
        },
        {
          name: 'IngestRfidRead',
          protocol: 'gRPC',
          description:
            'Accept FASTag RFID observation; attempt fusion or open orphan exception if unmatched past the window.',
        },
      ],
    },
    {
      name: 'Exception Orchestration',
      description: [
        'Owns LiDAR-flagged and orphan-sensor exceptions until a plate or tag attribution is resolved or the case is controlled-abandoned.',
        'Normalises vendor-specific LiDAR schemas into a common envelope; exposes aging/escalation to roadside ops.',
      ].join(' '),
      dependsOn: ['Sensor Fusion'],
      interfaces: [
        {
          name: 'OpenException',
          protocol: 'HTTP',
          description:
            'Open a Toll.OS exception workflow from a LiDAR or orphan RFID/ANPR event with reason codes and SLA clocks.',
        },
        {
          name: 'ResolveException',
          protocol: 'HTTP',
          description:
            'Resolve with plate/tag attribution and hand off to Event Metering for exactly one ₹5 charge.',
        },
      ],
    },
    {
      name: 'Event Metering',
      description: [
        'Creates the ₹5 Toll.OS orchestration event once a passage is attributed, including resolved exceptions.',
        'Enforces commercial invariants (one event per attribution) before the ledger persists — critical to LTV/payback assumptions.',
      ].join(' '),
      dependsOn: ['Sensor Fusion', 'Exception Orchestration'],
      interfaces: [
        {
          name: 'MeterOrchestrationEvent',
          protocol: 'HTTP',
          description:
            'Record exactly one ₹5 orchestration event for an attributed passage; reject duplicates by event key.',
        },
        {
          name: 'GetMeteringStatus',
          protocol: 'HTTP',
          description:
            'Return metering state for a passage/event key (pending fusion, metered, exception-open).',
        },
      ],
    },
    {
      name: 'Billing Ledger',
      description: [
        'Idempotent ledger and invoice export for Bosch MPS ₹5/event Toll.OS charges.',
        'Provides reconciliation joins for concessionaire revenue assurance and Bosch MPS commercial defence of the €1.5–2.0M value band.',
      ].join(' '),
      dependsOn: ['Event Metering'],
      interfaces: [
        {
          name: 'ExportDailyInvoice',
          protocol: 'HTTP',
          description:
            'Export distinct orchestration event IDs and ₹5 totals for the corridor day; counts must match ledger distinct keys.',
        },
        {
          name: 'GetReconciliationSlice',
          protocol: 'HTTP',
          description:
            'Return invoice lines joined to attribution summaries for a time range (no raw imagery beyond retention).',
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
    'packages/tollos/fusion/clockSkew.ts',
    'packages/tollos/exceptions/lidarWorkflow.ts',
    'packages/tollos/exceptions/vendorSchemaMap.ts',
    'packages/tollos/metering/eventLedger.ts',
    'packages/tollos/metering/eventKey.ts',
    'packages/tollos/metering/eventLedger.test.ts',
    'packages/tollos/billing/invoiceExport.ts',
    'packages/tollos/billing/reconciliation.ts',
    'packages/tollos/ops/exceptionQueue.ts',
  ]
  const noteText = [
    'Delivery shape for the ~€350–400k Toll.OS MLFF metering program (16–20 weeks, team of five):',
    '• Sensor Fusion — ANPR/RFID correlate with clock-skew budgets; orphan paths feed exceptions.',
    '• Exception Orchestration — LiDAR vendor schema map, open/resolve workflows, aging SLAs.',
    '• Event Metering — ₹5 orchestration events with idempotent event keys; late RFID metadata-only updates.',
    '• Billing Ledger — daily invoice export + reconciliation slices for concessionaire RA.',
    '• Ops — exception queue UX for roadside / revenue assurance.',
    'Risk remains medium-high on multi-vendor LiDAR schemas and free-flow clock skew; soak tests on the pilot corridor are mandatory before 2027 value run-rate.',
  ].join('\n')

  const note = await queryOne<{ id: number }>(
    `INSERT INTO graph_nodes (kind, label, description, metadata)
     VALUES ('IMPLEMENTATION_NOTE', $1, $2, $3::jsonb)
     RETURNING id`,
    [
      'Toll.OS ₹5 MLFF metering changeset (€350–400k program)',
      noteText,
      JSON.stringify({ featureId, files, risk: 'high', demo: true, effortCostEur: '350k-400k' }),
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
    { name: 'fuse-tolerates-gantry-clock-skew', status: 'passed' },
    { name: 'orphan-rfid-opens-exception', status: 'passed' },
    { name: 'lidar-exception-resolves-to-meter', status: 'passed' },
    { name: 'lidar-vendor-schema-normalises', status: 'passed' },
    { name: 'idempotent-replay-no-double-bill', status: 'passed' },
    { name: 'late-rfid-no-second-charge', status: 'passed' },
    { name: 'invoice-export-matches-ledger-count', status: 'passed' },
    { name: 'reconciliation-slice-joins-attribution', status: 'passed' },
    { name: 'imagery-ttl-purges-raw-frames', status: 'passed' },
    { name: 'exception-aging-escalates', status: 'passed' },
  ]
  const summary = [
    'Quality gate clear for Toll.OS MLFF metering — 12/12 fixtures passed.',
    'Covered: ANPR ₹5 metering, RFID+ANPR fusion (incl. clock skew), orphan RFID → exception, LiDAR vendor normalisation + resolve-to-meter,',
    'idempotent replay / late RFID, invoice=ledger counts, reconciliation joins, imagery TTL, and exception aging.',
    'Supports commercial claim: one ₹5 event per attributed passage toward the €1.5–2.0M/year value band from 2027.',
  ].join(' ')

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
        '1. Overview — Bosch MPS meters each attributed MLFF passage as a ₹5 Toll.OS orchestration event. Recovered capture across in-scope corridors underpins ~€1.5–2.0M/year from 2027 after a ~€350–400k delivery program.',
        '2. Sensor fusion — ANPR + FASTag RFID within the corridor fusion window (with clock-skew budget) produce one passage attribution. Orphan RFID/ANPR never silent-drops.',
        '3. Exceptions — LiDAR-flagged ambiguities and orphans open Exception Orchestration; vendor schemas normalise to a common envelope; resolve → exactly one ₹5 meter.',
        '4. Event metering — MeterOrchestrationEvent enforces commercial invariants before persist; late RFID updates metadata only.',
        '5. Billing ledger — Idempotent event keys; daily invoice export counts must equal distinct ledger IDs; reconciliation slices join invoice lines to attributions for revenue assurance.',
        '6. Privacy & compliance — Raw imagery retained only for the corridor-agreed window; ledger keeps durable IDs; access purpose-logged under operator DPA.',
        '7. Ops runbooks — Exception aging/escalation, soak-test checklist for pilot corridor, and go-live gates before multi-site rollout.',
        '8. Commercial hooks — Unit price ₹5/event; GTM uses LTV:CAC ~10–16× and ~8–11 month payback against the EUR value band.',
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
        '- Meter successful ANPR diagnoses as ₹5 Toll.OS orchestration events (SLA + event keys)',
        '- Fuse FASTag RFID with ANPR into a single passage event (clock-skew tolerant)',
        '- Route orphan RFID/ANPR to exception workflows (no silent drops)',
        '- Normalise multi-vendor LiDAR schemas; resolve → ₹5 meter with exception link',
        '- Enforce idempotent ledger keys; late RFID never double-bills',
        '- Daily invoice export must match distinct ledger IDs',
        '- Add reconciliation slices for concessionaire revenue assurance',
        '- Enforce imagery TTL / purpose-limited access under corridor DPA',
        '- Exception aging & escalation for roadside ops',
        '- Document €1.5–2.0M/year (from 2027) value band and €350–400k delivery shape for GTM/Portfolio',
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

  console.log(
    `Demo ready: 2 instances only — (1) ${TOLL_FEATURE} [loop closed] · (2) ${STAAS_FEATURE} [loop closed]`,
  )
  process.exit(0)
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
