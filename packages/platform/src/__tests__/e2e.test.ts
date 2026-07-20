/**
 * AVP E2E: Listen → Decide
 * Requires Platform API + Docker stack running:
 *   pnpm -F @avp/platform dev
 *   (Postgres on DB_PORT=5433, Redis, NATS)
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createHttpAdapter } from '@avp/shared/adapters/httpAdapter.js'
import { VoCIntelligenceAgent, VOC_MANIFEST } from '@avp/agents-listen-voc-intelligence'
import { BusinessCaseAgent, BUSINESS_CASE_MANIFEST } from '@avp/agents-decide-business-case'
import { createLLMGateway } from '../llm/llmGateway.js'
import type { HttpRuntimeAdapter } from '@avp/shared/adapters/httpAdapter.js'

const PLATFORM_URL = process.env.AVP_PLATFORM_URL ?? 'http://localhost:7070'

describe('AVP End-to-End: Listen → Decide', () => {
  let vocAdapter: HttpRuntimeAdapter
  let bcAdapter: HttpRuntimeAdapter
  const llm = createLLMGateway()

  beforeAll(async () => {
    const health = await fetch(`${PLATFORM_URL}/health`)
    if (!health.ok) {
      throw new Error(`Platform not healthy at ${PLATFORM_URL} — start with pnpm -F @avp/platform dev`)
    }
    vocAdapter = await createHttpAdapter(PLATFORM_URL, VOC_MANIFEST)
    bcAdapter = await createHttpAdapter(PLATFORM_URL, BUSINESS_CASE_MANIFEST)
  }, 60_000)

  it('should ingest signals and cluster pain points', async () => {
    const agent = new VoCIntelligenceAgent(vocAdapter, llm)
    const result = await agent.run({
      signals: [
        {
          date: '2026-07-16',
          cohort: 'enterprise',
          type: 'feature_request',
          text: 'We need bulk dispute filing for toll charges',
        },
        {
          date: '2026-07-16',
          cohort: 'fleet',
          type: 'pain_point',
          text: 'Manual dispute process wastes 3 hours weekly',
        },
        {
          date: '2026-07-16',
          cohort: 'enterprise',
          type: 'churn_risk',
          text: 'Considering switching providers due to poor dispute UX',
        },
        {
          date: '2026-07-16',
          cohort: 'fleet',
          type: 'feature_request',
          text: 'CSV upload for bulk dispute submission',
        },
        {
          date: '2026-07-16',
          cohort: 'individual',
          type: 'defect',
          text: 'Cannot find my transaction ID to submit a dispute',
        },
      ],
      cycleId: 'test-cycle-001',
    })
    expect(result.painPointIds.length).toBeGreaterThan(0)
    expect(result.topProblem).toBeTruthy()
  }, 120_000)

  it('should write an intake brief and create a feature node', async () => {
    const painPoints = await vocAdapter.graphRead<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE kind='PAIN_POINT' ORDER BY id DESC LIMIT 3`,
    )

    expect(painPoints.length).toBeGreaterThan(0)

    const agent = new BusinessCaseAgent(bcAdapter, llm)
    const result = await agent.run({
      painPointIds: painPoints.map((p) => p.id),
      painPointLabels: painPoints.map((p) => p.label),
      cycleId: 'test-cycle-001',
    })

    expect(result.briefId).toBeGreaterThan(0)
    expect(result.featureId).toBeGreaterThan(0)
  }, 120_000)

  it('should have written to audit_log for all operations', async () => {
    const logs = await vocAdapter.graphRead<{ agent_id: string; writes: string }>(
      `SELECT agent_id, COUNT(*)::text as writes FROM audit_log GROUP BY agent_id ORDER BY COUNT(*) DESC`,
    )

    expect(logs.length).toBeGreaterThan(0)
    const vocLogs = logs.find((l) => l.agent_id === 'voc-intelligence:v1')
    expect(vocLogs).toBeTruthy()
    expect(Number(vocLogs!.writes)).toBeGreaterThan(0)
  }, 30_000)
})
