import { createHttpAdapter } from '../packages/shared/dist/adapters/httpAdapter.js'
import { VoCIntelligenceAgent, VOC_MANIFEST } from '../packages/agents/listen/voc-intelligence/dist/index.js'
import { DevSecOpsAgent, DEVSECOPS_MANIFEST } from '../packages/agents/ship/devsecops/dist/index.js'
import type { ILLMGateway, LLMRequest, LLMResponse } from '../packages/shared/dist/index.js'

const PLATFORM = process.env.AVP_PLATFORM_URL ?? 'http://localhost:7070'

const stubLlm: ILLMGateway = {
  async isAvailable() {
    return false
  },
  async complete(req: LLMRequest): Promise<LLMResponse> {
    // Non-JSON stub → VoC falls back to single "General feedback" cluster
    return {
      text: `[Stub response for agent ${req.agentId}]`,
      provider: 'anthropic',
      tokensUsed: { input: 0, output: 12 },
      cached: false,
    }
  },
}

async function verifyVoc() {
  console.log('\n=== VoC Intelligence ===')
  const adapter = await createHttpAdapter(PLATFORM, VOC_MANIFEST)
  const agent = new VoCIntelligenceAgent(adapter, stubLlm)
  const result = await agent.run({
    cycleId: 'cycle-step5.1',
    signals: [
      {
        date: '2026-07-16',
        cohort: 'enterprise',
        type: 'feature_request',
        text: 'We need bulk dispute filing',
      },
      {
        date: '2026-07-16',
        cohort: 'fleet',
        type: 'pain_point',
        text: 'Disputing toll charges one by one wastes 3 hours a week',
      },
      {
        date: '2026-07-16',
        cohort: 'enterprise',
        type: 'churn_risk',
        text: 'Considering switching because of poor dispute UX',
      },
    ],
  })
  console.log(result)

  const nodes = await adapter.graphRead<{ kind: string; label: string }>(
    `SELECT kind, label FROM graph_nodes WHERE id = ANY($1::int[]) ORDER BY id`,
    [result.painPointIds],
  )
  console.log('pain point nodes:', nodes)
  await adapter.shutdown()
  return result.clusterCount >= 1 && result.painPointIds.length >= 1
}

async function verifyDevSecOpsClean() {
  console.log('\n=== DevSecOps (clean / no scanners) ===')
  const adapter = await createHttpAdapter(PLATFORM, DEVSECOPS_MANIFEST)
  const agent = new DevSecOpsAgent(adapter, stubLlm)
  const result = await agent.run({
    repoPath: process.cwd(),
    gitSha: 'abc123def456',
    runId: 'verify-step5.1-clean',
    cycleId: 'cycle-step5.1',
    fixtureFindings: [],
  })
  console.log(result)
  await adapter.shutdown()
  return result.blocking === false && result.findingIds.length === 0
}

async function verifyDevSecOpsBlocking() {
  console.log('\n=== DevSecOps (fixture CRITICAL → blocking) ===')
  const adapter = await createHttpAdapter(PLATFORM, DEVSECOPS_MANIFEST)
  const agent = new DevSecOpsAgent(adapter, stubLlm)
  const result = await agent.run({
    repoPath: process.cwd(),
    gitSha: 'deadbeef0001',
    runId: 'verify-step5.1-block',
    cycleId: 'cycle-step5.1',
    fixtureFindings: [
      {
        id: `AVP-FIXTURE-CRIT-${Date.now()}`,
        severity: 'CRITICAL',
        message: 'Fixture critical',
        path: 'fixture/app.ts',
        tool: 'fixture',
      },
    ],
  })
  console.log(result)
  await adapter.shutdown()
  return result.blocking === true && result.critical === 1 && result.findingIds.length === 1
}

async function main() {
  const a = await verifyVoc()
  const b = await verifyDevSecOpsClean()
  const c = await verifyDevSecOpsBlocking()
  if (!(a && b && c)) {
    console.error('FAILED', { a, b, c })
    process.exit(1)
  }
  console.log('\nALL STEP 5.1 REFERENCE AGENT CHECKS PASSED')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
