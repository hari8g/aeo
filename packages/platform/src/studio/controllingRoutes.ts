import type { FastifyInstance } from 'fastify'
import { query } from '../db/pool.js'

export function productClassFromMeta(meta: Record<string, unknown> | null | undefined): string {
  if (!meta) return 'Unclassified'
  if (typeof meta.productClass === 'string' && meta.productClass.trim()) return meta.productClass.trim()
  if (typeof meta.product === 'string' && meta.product.trim()) return meta.product.trim()
  return 'Unclassified'
}

type FeatureRow = {
  feature_id: number
  title: string
  feature_meta: Record<string, unknown>
  decision: string | null
  value_meta: Record<string, unknown> | null
  value_json: string | null
  effort_meta: Record<string, unknown> | null
  effort_json: string | null
  gtm_meta: Record<string, unknown> | null
  gtm_json: string | null
  owner_name: string | null
  owner_user_id: string | null
  cycle_stage: string | null
  story_count: string
  calibration_error: string | null
  realized_value: string | null
}

async function loadFeatureRows(): Promise<FeatureRow[]> {
  return query<FeatureRow>(`
    SELECT
      f.id as feature_id,
      f.label as title,
      f.metadata as feature_meta,
      (
        SELECT dr.metadata->>'decision' FROM graph_nodes dr
        WHERE dr.kind='DECISION_RECORD' AND dr.metadata->>'gate'='PORTFOLIO_GATE'
          AND (
            (dr.description::jsonb->>'featureId')::int = f.id
            OR (dr.metadata->>'cycleId') IN (SELECT id::text FROM cycles WHERE feature_id = f.id)
            OR EXISTS (
              SELECT 1 FROM graph_edges ge
              WHERE ge.from_node_id = dr.id AND ge.to_node_id = f.id
                AND ge.kind IN ('APPROVES','DEFERRED','REJECTS')
            )
          )
        ORDER BY dr.created_at DESC LIMIT 1
      ) as decision,
      (
        SELECT bi.metadata FROM graph_nodes bi
        JOIN graph_edges ge ON ge.from_node_id = bi.id AND ge.kind='ESTIMATES'
        WHERE ge.to_node_id = f.id AND bi.kind='BUSINESS_IMPACT'
        ORDER BY bi.created_at DESC LIMIT 1
      ) as value_meta,
      (
        SELECT bi.description FROM graph_nodes bi
        JOIN graph_edges ge ON ge.from_node_id = bi.id AND ge.kind='ESTIMATES'
        WHERE ge.to_node_id = f.id AND bi.kind='BUSINESS_IMPACT'
        ORDER BY bi.created_at DESC LIMIT 1
      ) as value_json,
      (
        SELECT di.metadata FROM graph_nodes di
        JOIN graph_edges ge ON ge.from_node_id = di.id AND ge.kind='ESTIMATES'
        WHERE ge.to_node_id = f.id AND di.kind='DEV_IMPACT'
        ORDER BY di.created_at DESC LIMIT 1
      ) as effort_meta,
      (
        SELECT di.description FROM graph_nodes di
        JOIN graph_edges ge ON ge.from_node_id = di.id AND ge.kind='ESTIMATES'
        WHERE ge.to_node_id = f.id AND di.kind='DEV_IMPACT'
        ORDER BY di.created_at DESC LIMIT 1
      ) as effort_json,
      (
        SELECT g.metadata FROM graph_nodes g
        JOIN graph_edges ge ON ge.from_node_id = g.id AND ge.kind IN ('INFORMS','ADDRESSES')
        WHERE ge.to_node_id = f.id AND g.kind='GTM_PROJECTION'
        ORDER BY g.created_at DESC LIMIT 1
      ) as gtm_meta,
      (
        SELECT g.description FROM graph_nodes g
        JOIN graph_edges ge ON ge.from_node_id = g.id AND ge.kind IN ('INFORMS','ADDRESSES')
        WHERE ge.to_node_id = f.id AND g.kind='GTM_PROJECTION'
        ORDER BY g.created_at DESC LIMIT 1
      ) as gtm_json,
      f.metadata->>'ownerUserId' as owner_user_id,
      (
        SELECT su.name FROM studio_users su
        WHERE su.id::text = f.metadata->>'ownerUserId' LIMIT 1
      ) as owner_name,
      (
        SELECT c.current_stage FROM cycles c
        WHERE c.feature_id = f.id ORDER BY c.created_at DESC LIMIT 1
      ) as cycle_stage,
      (
        SELECT COUNT(*)::text FROM graph_edges ge
        JOIN graph_nodes n ON n.id = ge.from_node_id AND n.kind = 'USER_STORY'
        WHERE ge.to_node_id = f.id
      ) as story_count,
      (
        SELECT ac.error_pct::text FROM agent_calibration ac
        JOIN cycles c ON c.id::text = ac.cycle_id
        WHERE c.feature_id = f.id ORDER BY ac.ts DESC LIMIT 1
      ) as calibration_error,
      (
        SELECT n.metadata->>'realizedValueEur' FROM graph_nodes n
        WHERE n.kind = 'IMPACT_ASSESSMENT'
          AND (n.metadata->>'featureId')::int = f.id
        ORDER BY n.created_at DESC LIMIT 1
      ) as realized_value
    FROM graph_nodes f
    WHERE f.kind = 'FEATURE'
      AND COALESCE(f.metadata->>'status', '') <> 'merged'
    ORDER BY f.created_at DESC
  `)
}

function num(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function parseFeatureEconomics(row: FeatureRow) {
  const meta = row.feature_meta ?? {}
  let valueLow: number | null = null
  let valueHigh: number | null = null
  let valueCurrency = 'EUR'
  let valueStartYear: number | null = null
  try {
    const v = row.value_json ? (JSON.parse(row.value_json) as Record<string, unknown>) : {}
    const vm = row.value_meta ?? {}
    valueLow = num(vm.valueLow ?? v.valueLow)
    valueHigh = num(vm.valueHigh ?? v.valueHigh)
    valueCurrency =
      typeof vm.valueCurrency === 'string'
        ? vm.valueCurrency
        : typeof v.valueCurrency === 'string'
          ? v.valueCurrency
          : 'EUR'
    valueStartYear = num(v.valueStartYear ?? vm.valueStartYear)
  } catch {
    /* ignore */
  }

  let effortWeeksLow: number | null = null
  let effortWeeksHigh: number | null = null
  let effortCostLow: number | null = null
  let effortCostHigh: number | null = null
  try {
    const e = row.effort_json ? (JSON.parse(row.effort_json) as Record<string, unknown>) : {}
    const em = row.effort_meta ?? {}
    effortWeeksLow = num(em.effortWeeksLow ?? e.effortWeeksLow)
    effortWeeksHigh = num(em.effortWeeksHigh ?? e.effortWeeksHigh)
    effortCostLow = num(em.effortCostLow ?? e.effortCostLow)
    effortCostHigh = num(em.effortCostHigh ?? e.effortCostHigh)
  } catch {
    /* ignore */
  }

  let topSegment: string | null = null
  let paybackMonthsLow: number | null = null
  let paybackMonthsHigh: number | null = null
  let ltvCacRatio: string | null = null
  try {
    const gm = row.gtm_meta ?? {}
    if (typeof gm.topSegment === 'string') topSegment = gm.topSegment
    if (row.gtm_json) {
      const g = JSON.parse(row.gtm_json) as {
        segments?: Array<{ name?: string; fit?: string }>
        economics?: {
          paybackMonthsLow?: number
          paybackMonthsHigh?: number
          ltvCacRatio?: string
        }
      }
      if (!topSegment) {
        const high = g.segments?.find((s) => s.fit === 'high')
        topSegment = high?.name ?? g.segments?.[0]?.name ?? null
      }
      paybackMonthsLow = num(g.economics?.paybackMonthsLow)
      paybackMonthsHigh = num(g.economics?.paybackMonthsHigh)
      ltvCacRatio = typeof g.economics?.ltvCacRatio === 'string' ? g.economics.ltvCacRatio : null
    }
  } catch {
    /* ignore */
  }

  const decision = (row.decision ?? '').toLowerCase()
  let status = 'Sizing'
  if (decision === 'admit') status = 'Admitted'
  else if (decision === 'defer') status = 'Deferred'
  else if (decision === 'reject') status = 'Rejected'

  return {
    feature_id: row.feature_id,
    title: row.title,
    product_class: productClassFromMeta(meta),
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_name,
    status,
    cycle_stage: row.cycle_stage,
    loop_closed: meta.loopClosed === true,
    value_low: valueLow,
    value_high: valueHigh,
    value_currency: valueCurrency,
    value_start_year: valueStartYear,
    effort_weeks_low: effortWeeksLow,
    effort_weeks_high: effortWeeksHigh,
    effort_cost_low: effortCostLow,
    effort_cost_high: effortCostHigh,
    top_segment: topSegment,
    payback_months_low: paybackMonthsLow,
    payback_months_high: paybackMonthsHigh,
    ltv_cac_ratio: ltvCacRatio,
    story_count: Number(row.story_count ?? 0),
    calibration_error_pct: row.calibration_error != null ? Number(row.calibration_error) : null,
    realized_value_eur: row.realized_value != null ? Number(row.realized_value) : null,
  }
}

export async function registerControllingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/studio/controlling/summary', async () => {
    const rows = await loadFeatureRows()
    const features = rows.map(parseFeatureEconomics)

    const byClass = new Map<
      string,
      {
        product_class: string
        program_count: number
        admitted_count: number
        closed_count: number
        value_low: number
        value_high: number
        delivery_cost_low: number
        delivery_cost_high: number
        realized_value_eur: number
        avg_calibration_error_pct: number | null
        features: typeof features
      }
    >()

    for (const f of features) {
      const key = f.product_class
      const bucket = byClass.get(key) ?? {
        product_class: key,
        program_count: 0,
        admitted_count: 0,
        closed_count: 0,
        value_low: 0,
        value_high: 0,
        delivery_cost_low: 0,
        delivery_cost_high: 0,
        realized_value_eur: 0,
        avg_calibration_error_pct: null as number | null,
        features: [] as typeof features,
      }
      bucket.program_count++
      if (f.status === 'Admitted') bucket.admitted_count++
      if (f.loop_closed) bucket.closed_count++
      bucket.value_low += f.value_low ?? 0
      bucket.value_high += f.value_high ?? 0
      bucket.delivery_cost_low += f.effort_cost_low ?? 0
      bucket.delivery_cost_high += f.effort_cost_high ?? 0
      bucket.realized_value_eur += f.realized_value_eur ?? 0
      bucket.features.push(f)
      byClass.set(key, bucket)
    }

    const product_classes = [...byClass.values()].map((b) => {
      const errors = b.features
        .map((f) => f.calibration_error_pct)
        .filter((e): e is number => e != null && Number.isFinite(e))
      return {
        ...b,
        avg_calibration_error_pct:
          errors.length > 0 ? errors.reduce((s, e) => s + e, 0) / errors.length : null,
      }
    })

    return {
      currency: 'EUR',
      product_classes,
      features,
      totals: {
        program_count: features.length,
        value_low: features.reduce((s, f) => s + (f.value_low ?? 0), 0),
        value_high: features.reduce((s, f) => s + (f.value_high ?? 0), 0),
        delivery_cost_low: features.reduce((s, f) => s + (f.effort_cost_low ?? 0), 0),
        delivery_cost_high: features.reduce((s, f) => s + (f.effort_cost_high ?? 0), 0),
        realized_value_eur: features.reduce((s, f) => s + (f.realized_value_eur ?? 0), 0),
      },
    }
  })

  app.get('/studio/controlling/export', async (_req, reply) => {
    const rows = await loadFeatureRows()
    const features = rows.map(parseFeatureEconomics)
    const header =
      'product_class,feature_id,title,status,owner,value_low_eur,value_high_eur,delivery_cost_low_eur,delivery_cost_high_eur,realized_value_eur,calibration_error_pct,top_segment,cycle_stage,loop_closed'
    const lines = features.map((f) =>
      [
        f.product_class,
        f.feature_id,
        `"${f.title.replace(/"/g, '""')}"`,
        f.status,
        f.owner_name ?? '',
        f.value_low ?? '',
        f.value_high ?? '',
        f.effort_cost_low ?? '',
        f.effort_cost_high ?? '',
        f.realized_value_eur ?? '',
        f.calibration_error_pct ?? '',
        f.top_segment ?? '',
        f.cycle_stage ?? '',
        f.loop_closed,
      ].join(','),
    )
    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', 'attachment; filename="mps-portfolio-by-class.csv"')
    return reply.send([header, ...lines].join('\n'))
  })

  app.get<{ Params: { id: string } }>('/studio/features/:id/effectiveness', async (req, reply) => {
    const featureId = parseInt(req.params.id, 10)
    if (!Number.isFinite(featureId)) return reply.status(400).send({ error: 'invalid id' })

    const row = (await loadFeatureRows()).find((r) => r.feature_id === featureId)
    if (!row) return reply.status(404).send({ error: 'Feature not found' })

    const econ = parseFeatureEconomics(row)
    const meta = row.feature_meta ?? {}

    const hypotheses = await query<{
      label: string
      description: string
      metadata: Record<string, unknown>
    }>(
      `SELECT n.label, n.description, n.metadata FROM graph_nodes n
       JOIN graph_edges ge ON ge.from_node_id = n.id AND ge.kind = 'TESTS'
       WHERE ge.to_node_id = $1 AND n.kind = 'VALUE_HYPOTHESIS'
       ORDER BY n.id`,
      [featureId],
    )

    const verdicts = await query<{ label: string; description: string }>(
      `SELECT label, description FROM graph_nodes
       WHERE kind = 'HYPOTHESIS_VERDICT' AND metadata->>'featureId' = $1
       ORDER BY created_at DESC`,
      [String(featureId)],
    )

    const hasImpl = await query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM graph_nodes n
         JOIN graph_edges ge ON ge.from_node_id = n.id
         WHERE ge.to_node_id = $1 AND n.kind = 'IMPLEMENTATION_NOTE'
       ) as exists`,
      [featureId],
    )

    const qaPassed = await query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM graph_nodes n
         WHERE n.kind = 'QUALITY_GATE' AND n.metadata->>'featureId' = $1
           AND n.metadata->>'passed' = 'true'
       ) as exists`,
      [String(featureId)],
    )

    const valueAccuracy =
      econ.calibration_error_pct != null
        ? econ.calibration_error_pct <= 5
          ? 'on_track'
          : econ.calibration_error_pct <= 15
            ? 'watch'
            : 're_estimate'
        : null

    return {
      ...econ,
      sizing_accuracy: {
        value_status: valueAccuracy,
        calibration_error_pct: econ.calibration_error_pct,
        realized_value_eur: econ.realized_value_eur,
        committed_value_low: econ.value_low,
        committed_value_high: econ.value_high,
      },
      delivery_health: {
        story_count: econ.story_count,
        has_implementation: !!hasImpl[0]?.exists,
        qa_passed: !!qaPassed[0]?.exists,
        cycle_stage: econ.cycle_stage,
        loop_closed: econ.loop_closed,
      },
      hypotheses: hypotheses.map((h) => {
        let parsed: Record<string, unknown> = {}
        try {
          parsed = JSON.parse(h.description) as Record<string, unknown>
        } catch {
          parsed = { rationale: h.description }
        }
        const verdict = verdicts.find((v) => v.label.includes(String(parsed.kpi ?? '')))
        return {
          kpi: parsed.kpi ?? h.label,
          direction: parsed.direction,
          magnitude_pct: parsed.magnitudePct,
          timeframe_days: parsed.timeframeDays,
          rationale: parsed.rationale ?? h.description,
          verdict: verdict?.description ?? null,
        }
      }),
      stage: meta.stage ?? econ.cycle_stage,
    }
  })

  app.get('/studio/calibration/summary', async () => {
    const rows = await query<{
      agent_id: string
      kpi: string
      error_pct: number
      predicted_value: number
      actual_value: number
      feature_id: number
      feature_label: string
      feature_meta: Record<string, unknown>
    }>(`
      SELECT ac.agent_id, ac.kpi, ac.error_pct, ac.predicted_value, ac.actual_value,
             c.feature_id, f.label as feature_label, f.metadata as feature_meta
      FROM agent_calibration ac
      JOIN cycles c ON c.id::text = ac.cycle_id
      JOIN graph_nodes f ON f.id = c.feature_id
      ORDER BY ac.ts DESC
    `)

    const byAgent = new Map<
      string,
      {
        agent_id: string
        samples: number
        records: Array<(typeof rows)[0] & { product_class: string }>
      }
    >()

    for (const r of rows) {
      const enriched = {
        ...r,
        product_class: productClassFromMeta(r.feature_meta),
      }
      const bucket = byAgent.get(r.agent_id) ?? {
        agent_id: r.agent_id,
        samples: 0,
        records: [] as Array<(typeof rows)[0] & { product_class: string }>,
      }
      bucket.samples++
      bucket.records.push(enriched)
      byAgent.set(r.agent_id, bucket)
    }

    const agents = [...byAgent.values()].map((b) => ({
      agent_id: b.agent_id,
      samples: b.samples,
      avg_error_pct:
        b.records.reduce((s, r) => s + Number(r.error_pct), 0) / Math.max(b.records.length, 1),
      trend:
        b.records.length >= 2 && b.records[0].error_pct < b.records[b.records.length - 1].error_pct
          ? 'improving'
          : b.records.length >= 2 &&
              b.records[0].error_pct > b.records[b.records.length - 1].error_pct
            ? 'degrading'
            : 'stable',
      records: b.records.slice(0, 5),
    }))

    return { agents, total_samples: rows.length }
  })

  app.get('/studio/gtm/segments', async () => {
    const rows = await query<{
      feature_id: number
      title: string
      feature_meta: Record<string, unknown>
      gtm_json: string | null
      value_meta: Record<string, unknown> | null
    }>(`
      SELECT f.id as feature_id, f.label as title, f.metadata as feature_meta,
        (
          SELECT g.description FROM graph_nodes g
          JOIN graph_edges ge ON ge.from_node_id = g.id AND ge.kind IN ('INFORMS','ADDRESSES')
          WHERE ge.to_node_id = f.id AND g.kind='GTM_PROJECTION'
          ORDER BY g.created_at DESC LIMIT 1
        ) as gtm_json,
        (
          SELECT bi.metadata FROM graph_nodes bi
          JOIN graph_edges ge ON ge.from_node_id = bi.id AND ge.kind='ESTIMATES'
          WHERE ge.to_node_id = f.id AND bi.kind='BUSINESS_IMPACT'
          ORDER BY bi.created_at DESC LIMIT 1
        ) as value_meta
      FROM graph_nodes f
      WHERE f.kind = 'FEATURE' AND COALESCE(f.metadata->>'status','') <> 'merged'
    `)

    const segmentMap = new Map<
      string,
      {
        name: string
        feature_count: number
        product_classes: Set<string>
        value_low: number
        value_high: number
        fit_high_count: number
      }
    >()

    for (const row of rows) {
      const productClass = productClassFromMeta(row.feature_meta)
      let valueLow = num(row.value_meta?.valueLow) ?? 0
      let valueHigh = num(row.value_meta?.valueHigh) ?? 0
      if (!row.gtm_json) continue
      try {
        const g = JSON.parse(row.gtm_json) as {
          segments?: Array<{
            name?: string
            fit?: string
            ltvLowEur?: number
            ltvHighEur?: number
          }>
        }
        for (const seg of g.segments ?? []) {
          if (!seg.name) continue
          const bucket = segmentMap.get(seg.name) ?? {
            name: seg.name,
            feature_count: 0,
            product_classes: new Set<string>(),
            value_low: 0,
            value_high: 0,
            fit_high_count: 0,
          }
          bucket.feature_count++
          bucket.product_classes.add(productClass)
          bucket.value_low += valueLow
          bucket.value_high += valueHigh
          if (seg.fit === 'high') bucket.fit_high_count++
          segmentMap.set(seg.name, bucket)
        }
      } catch {
        /* ignore */
      }
    }

    return {
      segments: [...segmentMap.values()]
        .map((s) => ({
          name: s.name,
          feature_count: s.feature_count,
          product_classes: [...s.product_classes],
          value_low: s.value_low,
          value_high: s.value_high,
          fit_high_count: s.fit_high_count,
        }))
        .sort((a, b) => b.value_high - a.value_high),
    }
  })
}
