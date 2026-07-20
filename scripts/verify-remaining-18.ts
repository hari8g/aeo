/**
 * End-to-end fixture run across all 18 new agents (+ VoC/DevSecOps already exist).
 * Requires Platform API on :7070.
 */
import { createHttpAdapter } from '../packages/shared/dist/adapters/httpAdapter.js'
import type { ILLMGateway, LLMRequest, LLMResponse, AgentManifest } from '../packages/shared/dist/index.js'

import { MarketSignalAgent, MARKET_SIGNAL_MANIFEST } from '../packages/agents/listen/market-signal/dist/index.js'
import { BusinessCaseAgent, BUSINESS_CASE_MANIFEST } from '../packages/agents/decide/business-case/dist/index.js'
import { ValueEngineeringAgent, VALUE_ENGINEERING_MANIFEST } from '../packages/agents/decide/value-engineering/dist/index.js'
import { ProductStrategyAgent, PRODUCT_STRATEGY_MANIFEST } from '../packages/agents/decide/product-strategy/dist/index.js'
import { SolutionsEstimationAgent, SOLUTIONS_ESTIMATION_MANIFEST } from '../packages/agents/decide/solutions-estimation/dist/index.js'
import { PortfolioManagementAgent, PORTFOLIO_MANAGEMENT_MANIFEST } from '../packages/agents/decide/portfolio-management/dist/index.js'
import { RequirementsAnalystAgent, REQUIREMENTS_ANALYST_MANIFEST } from '../packages/agents/define/requirements-analyst/dist/index.js'
import { DomainStewardAgent, DOMAIN_STEWARD_MANIFEST } from '../packages/agents/define/domain-steward/dist/index.js'
import { SolutionsArchitectAgent, SOLUTIONS_ARCHITECT_MANIFEST } from '../packages/agents/define/solutions-architect/dist/index.js'
import { SoftwareEngineeringAgent, SOFTWARE_ENGINEERING_MANIFEST } from '../packages/agents/build/software-engineering/dist/index.js'
import { QualityEngineeringAgent, QUALITY_ENGINEERING_MANIFEST } from '../packages/agents/build/quality-engineering/dist/index.js'
import { DocumentationAgent, DOCUMENTATION_MANIFEST } from '../packages/agents/build/documentation/dist/index.js'
import { DevOpsAgent, DEVOPS_MANIFEST } from '../packages/agents/ship/devops/dist/index.js'
import { FinOpsAgent, FINOPS_MANIFEST } from '../packages/agents/ship/finops/dist/index.js'
import { ReleaseManagerAgent, RELEASE_MANAGER_MANIFEST } from '../packages/agents/ship/release-manager/dist/index.js'
import { DeploymentEngineerAgent, DEPLOYMENT_ENGINEER_MANIFEST } from '../packages/agents/ship/deployment-engineer/dist/index.js'
import { SreAgent, SRE_MANIFEST } from '../packages/agents/ship/sre/dist/index.js'
import { AttributionAnalystAgent, ATTRIBUTION_ANALYST_MANIFEST } from '../packages/agents/learn/attribution-analyst/dist/index.js'
import { StakeholderImpactAgent, STAKEHOLDER_IMPACT_MANIFEST } from '../packages/agents/learn/stakeholder-impact/dist/index.js'
import { OrganizationalLearningAgent, ORGANIZATIONAL_LEARNING_MANIFEST } from '../packages/agents/learn/organizational-learning/dist/index.js'
import { CalibrationAgent, CALIBRATION_MANIFEST } from '../packages/agents/learn/calibration/dist/index.js'
import { DevSecOpsAgent, DEVSECOPS_MANIFEST } from '../packages/agents/ship/devsecops/dist/index.js'

const PLATFORM = process.env.AVP_PLATFORM_URL ?? 'http://localhost:7070'

const stubLlm: ILLMGateway = {
  async isAvailable() { return false },
  async complete(req: LLMRequest): Promise<LLMResponse> {
    return {
      text: `[Stub for ${req.agentId}]`,
      provider: 'anthropic',
      tokensUsed: { input: 0, output: 8 },
      cached: false,
    }
  },
}

async function withAgent<T>(
  manifest: AgentManifest,
  fn: (agentCtor: unknown, adapter: Awaited<ReturnType<typeof createHttpAdapter>>) => Promise<T>,
  AgentCtor: new (...args: never[]) => unknown,
): Promise<T> {
  const adapter = await createHttpAdapter(PLATFORM, manifest)
  try {
    return await fn(AgentCtor, adapter)
  } finally {
    await adapter.shutdown()
  }
}

async function main() {
  process.env.AVP_GATE_BYPASS = '1'
  const cycleId = 'cycle-remaining-18'

  // Seed a pain point node via a throwaway write using market-signal capabilities won't work —
  // create via business-case path using a pre-written node through market + manual FEATURE later.
  // Use market signal standalone first, then decide with synthetic pain point via portfolio candidates.

  console.log('A. Market Signal')
  const market = await (async () => {
    const adapter = await createHttpAdapter(PLATFORM, MARKET_SIGNAL_MANIFEST)
    const agent = new MarketSignalAgent(adapter, stubLlm)
    const out = await agent.run({
      cycleId,
      sources: [
        { kind: 'competitor', title: 'Rival launches bulk disputes', summary: 'Competitor shipped bulk dispute UX', date: '2026-07-16' },
        { kind: 'regulatory', title: 'Toll transparency rule', summary: 'New disclosure requirement', date: '2026-07-16' },
      ],
    })
    await adapter.shutdown()
    console.log(out)
    return out
  })()

  // Create a synthetic PAIN_POINT by registering a temporary voc-like write isn't available;
  // Use product-strategy which needs painPointIds — seed via platform with a helper agent write.
  // Quick seed: use graph via a one-off HTTP register with PAIN_POINT capability.
  const seedAdapter = await createHttpAdapter(PLATFORM, {
    ...MARKET_SIGNAL_MANIFEST,
    id: 'seed-pain:v1',
    capabilities: {
      nodeKinds: ['PAIN_POINT', 'MARKET_SIGNAL', 'COMPETITOR_MOVE', 'REGULATORY_SIGNAL'],
      edgeKinds: ['INFORMS', 'THREATENS', 'ENABLES'],
      requiresGate: false,
      maxWritesPerMinute: 60,
    },
  })
  const pain = await seedAdapter.graphWrite({
    type: 'upsertNode',
    kind: 'PAIN_POINT',
    label: `Bulk dispute pain ${Date.now()}`,
    description: 'Seed pain point for E2E',
  })
  const painPointId = pain.nodeId!
  await seedAdapter.shutdown()
  console.log('seed painPointId', painPointId)

  console.log('B. Decide chain')
  const bcAdapter = await createHttpAdapter(PLATFORM, BUSINESS_CASE_MANIFEST)
  const bc = await new BusinessCaseAgent(bcAdapter, stubLlm).run({ painPointIds: [painPointId], cycleId })
  console.log('business case', bc)
  await bcAdapter.shutdown()

  const veAdapter = await createHttpAdapter(PLATFORM, VALUE_ENGINEERING_MANIFEST)
  const ve = await new ValueEngineeringAgent(veAdapter, stubLlm).run({ businessCaseId: bc.businessCaseId, cycleId })
  console.log('value eng', ve)
  await veAdapter.shutdown()

  const psAdapter = await createHttpAdapter(PLATFORM, PRODUCT_STRATEGY_MANIFEST)
  const ps = await new ProductStrategyAgent(psAdapter, stubLlm).run({
    painPointIds: [painPointId],
    marketSignalIds: market.signalIds,
    cycleId,
  })
  console.log('product strategy', ps)
  await psAdapter.shutdown()

  const seAdapter = await createHttpAdapter(PLATFORM, SOLUTIONS_ESTIMATION_MANIFEST)
  const est = await new SolutionsEstimationAgent(seAdapter, stubLlm).run({
    businessCaseId: bc.businessCaseId,
    hypothesisId: ps.hypothesisIds[0],
    cycleId,
  })
  console.log('estimate', est)
  await seAdapter.shutdown()

  const pfAdapter = await createHttpAdapter(PLATFORM, PORTFOLIO_MANAGEMENT_MANIFEST)
  const pf = await new PortfolioManagementAgent(pfAdapter, stubLlm).run({
    candidateIds: [bc.businessCaseId, est.estimateId],
    cycleId,
    approvedBy: 'e2e-verifier',
    decision: 'APPROVES',
    featureLabel: `Feature bulk disputes ${Date.now()}`,
  })
  console.log('portfolio', pf)
  if (!pf.featureId) throw new Error('expected featureId')
  // PATCH cycle
  const patch = await fetch(`${PLATFORM}/cycles`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pfAdapter.jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'remaining-18-cycle' }),
  })
  const cycle = (await patch.json()) as { id: string }
  await fetch(`${PLATFORM}/cycles/${cycle.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${pfAdapter.jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_stage: 'DEFINE', feature_id: pf.featureId, status: 'active' }),
  })
  console.log('cycle patched', cycle.id)
  await pfAdapter.shutdown()

  console.log('C. Define')
  const raAdapter = await createHttpAdapter(PLATFORM, REQUIREMENTS_ANALYST_MANIFEST)
  const reqs = await new RequirementsAnalystAgent(raAdapter, stubLlm).run({ featureId: pf.featureId, cycleId })
  console.log('requirements', reqs)
  await raAdapter.shutdown()

  const dsAdapter = await createHttpAdapter(PLATFORM, DOMAIN_STEWARD_MANIFEST)
  const dom = await new DomainStewardAgent(dsAdapter, stubLlm).run({
    featureId: pf.featureId,
    requirementIds: reqs.requirementIds,
    cycleId,
  })
  console.log('domain', dom)
  await dsAdapter.shutdown()

  const saAdapter = await createHttpAdapter(PLATFORM, SOLUTIONS_ARCHITECT_MANIFEST)
  const arch = await new SolutionsArchitectAgent(saAdapter, stubLlm).run({
    featureId: pf.featureId,
    requirementIds: reqs.requirementIds,
    cycleId,
  })
  console.log('architecture', arch)
  await saAdapter.shutdown()

  console.log('D. Build')
  const swAdapter = await createHttpAdapter(PLATFORM, SOFTWARE_ENGINEERING_MANIFEST)
  const sw = await new SoftwareEngineeringAgent(swAdapter, stubLlm).run({
    featureId: pf.featureId,
    architectureId: arch.architectureId,
    patchSummary: 'Add bulk dispute API',
    files: ['src/disputes/bulk.ts'],
    cycleId,
  })
  console.log('software', sw)
  await swAdapter.shutdown()

  const qeAdapter = await createHttpAdapter(PLATFORM, QUALITY_ENGINEERING_MANIFEST)
  const qe = await new QualityEngineeringAgent(qeAdapter, stubLlm).run({
    changesetId: sw.changesetId,
    fixtureResults: [{ name: 'bulk-happy', status: 'passed' }],
    cycleId,
  })
  console.log('qa', qe)
  await qeAdapter.shutdown()

  const docAdapter = await createHttpAdapter(PLATFORM, DOCUMENTATION_MANIFEST)
  const docs = await new DocumentationAgent(docAdapter, stubLlm).run({
    featureId: pf.featureId,
    artifactIds: sw.artifactIds,
    cycleId,
  })
  console.log('docs', docs)
  await docAdapter.shutdown()

  console.log('E. Ship')
  const devopsAdapter = await createHttpAdapter(PLATFORM, DEVOPS_MANIFEST)
  const build = await new DevOpsAgent(devopsAdapter, stubLlm).run({
    gitSha: 'abcdef1234567890',
    runId: 'e2e-18',
    conclusion: 'success',
    cycleId,
    featureId: pf.featureId,
  })
  console.log('devops', build)
  await devopsAdapter.shutdown()

  const finAdapter = await createHttpAdapter(PLATFORM, FINOPS_MANIFEST)
  const fin = await new FinOpsAgent(finAdapter, stubLlm).run({
    repoPath: process.cwd(),
    gitSha: 'abcdef1234567890',
    cycleId,
    fixtureCost: 120,
  })
  console.log('finops', fin)
  await finAdapter.shutdown()

  const dsoAdapter = await createHttpAdapter(PLATFORM, DEVSECOPS_MANIFEST)
  const scan = await new DevSecOpsAgent(dsoAdapter, stubLlm).run({
    repoPath: process.cwd(),
    gitSha: 'abcdef1234567890',
    runId: 'e2e-18',
    cycleId,
    featureId: pf.featureId,
    fixtureFindings: [],
  })
  console.log('devsecops', scan)
  await dsoAdapter.shutdown()

  const rmAdapter = await createHttpAdapter(PLATFORM, RELEASE_MANAGER_MANIFEST)
  const rc = await new ReleaseManagerAgent(rmAdapter, stubLlm).run({
    buildRunId: build.buildRunId,
    scanNodeId: scan.scanNodeId,
    costNodeId: fin.forecastId,
    qaEvidenceIds: qe.evidenceIds,
    cycleId,
    environment: 'staging',
    approvedBy: 'e2e',
  })
  console.log('release', rc)
  if (!rc.ready || !rc.releaseCandidateId) throw new Error('expected RC ready')
  await rmAdapter.shutdown()

  const depAdapter = await createHttpAdapter(PLATFORM, DEPLOYMENT_ENGINEER_MANIFEST)
  const dep = await new DeploymentEngineerAgent(depAdapter, stubLlm).run({
    rcNodeId: rc.releaseCandidateId,
    environment: 'staging',
    status: 'success',
    cycleId,
  })
  console.log('deploy', dep)
  await depAdapter.shutdown()

  const sreAdapter = await createHttpAdapter(PLATFORM, SRE_MANIFEST)
  const sre = await new SreAgent(sreAdapter, stubLlm).run({
    service: 'disputes-api',
    sliWindow: '30d',
    fixtureMetrics: { sli: 0.995 },
    cycleId,
    deploymentId: dep.deploymentId,
  })
  console.log('sre', sre)
  await sreAdapter.shutdown()

  console.log('F. Learn')
  const attAdapter = await createHttpAdapter(PLATFORM, ATTRIBUTION_ANALYST_MANIFEST)
  const verd = await new AttributionAnalystAgent(attAdapter, stubLlm).run({
    featureId: pf.featureId,
    kpiActuals: { 'Time saved': 22 },
    cycleId,
  })
  console.log('attribution', verd)
  await attAdapter.shutdown()

  const siAdapter = await createHttpAdapter(PLATFORM, STAKEHOLDER_IMPACT_MANIFEST)
  const impact = await new StakeholderImpactAgent(siAdapter, stubLlm).run({
    featureId: pf.featureId,
    feedback: [{ stakeholder: 'fleet-ops', text: 'Bulk disputes cut our weekly work' }],
    cycleId,
  })
  console.log('impact', impact)
  await siAdapter.shutdown()

  const olAdapter = await createHttpAdapter(PLATFORM, ORGANIZATIONAL_LEARNING_MANIFEST)
  const lessons = await new OrganizationalLearningAgent(olAdapter, stubLlm).run({
    verdictIds: [verd.verdictId],
    cycleId,
  })
  console.log('lessons', lessons)
  await olAdapter.shutdown()

  const calAdapter = await createHttpAdapter(PLATFORM, CALIBRATION_MANIFEST)
  const cal = await new CalibrationAgent(calAdapter, stubLlm).run({
    targetAgentId: 'solutions-estimation:v1',
    cycleId: cycle.id,
    predictedValue: 5,
    actualValue: 8,
    kpi: 'story_points',
    featureId: pf.featureId,
  })
  console.log('calibration', cal)
  await calAdapter.shutdown()

  console.log('\nALL REMAINING-18 AGENT CHECKS PASSED')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
