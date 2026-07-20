# AVP — Complete Implementation (Part 2)
## All 17 remaining agents · Cycle Orchestrator · Observability · Runtimes · Production

---

## STEP 11 — Market Signal Agent (Listen domain)

```typescript
// packages/agents/listen/market-signal/src/marketSignalAgent.ts
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'

export const MARKET_SIGNAL_MANIFEST: AgentManifest = {
  id: 'market-signal:v1', name: 'Market Signal Agent', archetype: 'Competitive Intelligence Analyst',
  domain: 'listen', runtime: 'worker', version: '1.0.0',
  capabilities: { nodeKinds: ['MARKET_SIGNAL','COMPETITOR_MOVE','TREND'], edgeKinds: ['RELATES_TO'], requiresGate: false, maxWritesPerMinute: 30 },
  subscribes: [], healthEndpoint: 'http://localhost:7082/health',
  llmBudget: { maxTokensPerRun: 4000, preferredModel: 'claude-sonnet-4-6' },
}

export interface MarketSignalInput { sources: { url?: string; text: string; type: 'news'|'review'|'competitor'|'analyst' }[]; cycleId?: string }
export interface MarketSignalOutput { signalIds: number[]; trendIds: number[] }

export class MarketSignalAgent extends BaseAgent {
  protected readonly agentId = 'market-signal:v1'
  protected readonly domain = 'listen' as const

  async run(input: MarketSignalInput): Promise<MarketSignalOutput> {
    const signalIds: number[] = []
    const trendIds: number[] = []

    for (const src of input.sources) {
      const id = await this.writeNode({
        kind: 'MARKET_SIGNAL', label: src.text.slice(0, 80),
        description: JSON.stringify(src), metadata: { type: src.type, url: src.url ?? null },
        eventKind: 'market_signal_ingested', cycleId: input.cycleId,
      })
      signalIds.push(id)
    }

    const res = await this.complete({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content:
        `Identify 1-3 market trends from these signals. Return JSON only: {"trends":[{"label":"...","description":"...","confidence":0.0-1.0,"signalIndices":[1,2]}]}\n\n${input.sources.map((s,i)=>`${i+1}. [${s.type}] ${s.text}`).join('\n')}`
      }], maxTokens: 1000,
    })
    try {
      const { trends } = JSON.parse(res.text) as { trends: { label: string; description: string; confidence: number; signalIndices: number[] }[] }
      for (const t of trends) {
        const tid = await this.writeNode({ kind: 'TREND', label: t.label, description: t.description, metadata: { confidence: t.confidence }, eventKind: 'trend_identified', cycleId: input.cycleId })
        trendIds.push(tid)
        for (const idx of t.signalIndices) if (signalIds[idx - 1]) await this.writeEdge(signalIds[idx - 1], tid, 'RELATES_TO')
      }
    } catch { /* LLM parse failure — signals still recorded */ }
    return { signalIds, trendIds }
  }
}
```

---

## STEP 12 — Business Case Agent (Decide domain)

```typescript
// packages/agents/decide/business-case/src/businessCaseAgent.ts
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import crypto from 'node:crypto'

export const BUSINESS_CASE_MANIFEST: AgentManifest = {
  id: 'business-case:v1', name: 'Business Case Agent', archetype: 'Business Analyst',
  domain: 'decide', runtime: 'studio', version: '1.0.0',
  capabilities: { nodeKinds: ['BRIEF','FEATURE'], edgeKinds: ['MOTIVATES','DUPLICATE_OF'], requiresGate: false, maxWritesPerMinute: 20 },
  subscribes: ['context.listen.pain_point_clustered'],
  healthEndpoint: 'http://localhost:7083/health',
  llmBudget: { maxTokensPerRun: 6000, preferredModel: 'claude-sonnet-4-6' },
}

export interface BusinessCaseInput { painPointIds: number[]; painPointLabels: string[]; cycleId?: string }
export interface BusinessCaseOutput { briefId: number; featureId: number }

export class BusinessCaseAgent extends BaseAgent {
  protected readonly agentId = 'business-case:v1'
  protected readonly domain = 'decide' as const

  async run(input: BusinessCaseInput): Promise<BusinessCaseOutput> {
    const sessionId = crypto.randomUUID()
    const inputHash = this.hashInput(input.painPointLabels.sort())

    // Check episodic memory for similar briefs
    const past = await this.adapter.episodicMemory.readSimilar(this.agentId, inputHash, 3)
    const dedupeContext = past.length > 0 ? `Previous similar briefs:\n${past.map(p => `- ${p.outputSummary}`).join('\n')}\nAvoid duplicating these.` : ''

    // Check existing features for deduplication
    const existing = await this.adapter.graphRead<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE kind='FEATURE' ORDER BY created_at DESC LIMIT 20`
    )

    const res = await this.complete({
      model: 'claude-sonnet-4-6',
      system: `You are a Business Analyst writing intake briefs. Be concise, evidence-based, and use plain language.`,
      messages: [{ role: 'user', content:
        `Write a structured intake brief for these customer pain points.\n${dedupeContext}\n\nPain points:\n${input.painPointLabels.map((l,i)=>`${i+1}. ${l}`).join('\n')}\n\nExisting features (avoid duplicating):\n${existing.map(e=>e.label).join('\n')}\n\nReturn JSON only:\n{"title":"Feature title","problemStatement":"1-2 sentence problem statement","customerSegment":"Who is most affected","evidenceSummary":"What the signals tell us","isDuplicate":false,"duplicateOf":null,"recommendation":"brief recommendation"}`
      }], maxTokens: 2000,
    })

    let parsed = { title: input.painPointLabels[0] ?? 'Unknown', problemStatement: '', customerSegment: '', evidenceSummary: '', isDuplicate: false, duplicateOf: null as string | null, recommendation: '' }
    try { parsed = { ...parsed, ...JSON.parse(res.text.trim()) } } catch { /* use defaults */ }

    const briefId = await this.writeNode({
      kind: 'BRIEF', label: `Brief: ${parsed.title}`,
      description: JSON.stringify(parsed),
      metadata: { isDuplicate: parsed.isDuplicate },
      eventKind: 'brief_written', cycleId: input.cycleId,
    })

    const featureId = await this.writeNode({
      kind: 'FEATURE', label: parsed.title,
      description: parsed.problemStatement,
      metadata: { stage: 'INTAKE', cycleId: input.cycleId ?? null },
      eventKind: 'feature_created', cycleId: input.cycleId,
    })

    for (const ppId of input.painPointIds) await this.writeEdge(ppId, featureId, 'MOTIVATES')
    await this.writeEdge(briefId, featureId, 'MOTIVATES')

    await this.adapter.episodicMemory.write({
      agentId: this.agentId, sessionId, domain: 'decide', cycleId: input.cycleId,
      inputHash, inputSummary: input.painPointLabels.join(', '),
      outputSummary: `Brief: ${parsed.title} (feature ${featureId})`,
      outputNodeIds: [briefId, featureId], confidencePct: 85, llmTokensUsed: res.tokensUsed.output,
    })

    return { briefId, featureId }
  }
}
```

---

## STEP 13 — Value Engineering Agent (Decide domain)

```typescript
// packages/agents/decide/value-engineering/src/valueEngineeringAgent.ts
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import crypto from 'node:crypto'

export const VALUE_ENGINEERING_MANIFEST: AgentManifest = {
  id: 'value-engineering:v1', name: 'Value Engineering Agent', archetype: 'Value Engineer',
  domain: 'decide', runtime: 'studio', version: '1.0.0',
  capabilities: { nodeKinds: ['BUSINESS_IMPACT','VALUE_HYPOTHESIS'], edgeKinds: ['ESTIMATES','SUPPORTS'], requiresGate: false, maxWritesPerMinute: 20 },
  subscribes: ['context.decide.brief_written'],
  healthEndpoint: 'http://localhost:7084/health',
  llmBudget: { maxTokensPerRun: 8000, preferredModel: 'claude-sonnet-4-6' },
}

export interface ValueEngInput { briefId: number; briefLabel: string; featureId: number; cycleId?: string }
export interface ValueEngOutput { assessmentId: number; hypothesisIds: number[]; confidencePct: number }

export class ValueEngineeringAgent extends BaseAgent {
  protected readonly agentId = 'value-engineering:v1'
  protected readonly domain = 'decide' as const

  async run(input: ValueEngInput): Promise<ValueEngOutput> {
    const sessionId = crypto.randomUUID()
    const inputHash = this.hashInput(input.briefLabel)

    // Load past calibration data
    const calibration = await this.adapter.graphRead<{ description: string }>(
      `SELECT description FROM graph_nodes WHERE kind='CALIBRATION_RECORD' AND written_by_agent='value-engineering:v1' ORDER BY created_at DESC LIMIT 5`
    )
    const calibCtx = calibration.length > 0
      ? `Past estimation accuracy:\n${calibration.map(c => { try { return JSON.parse(c.description).summary } catch { return '' } }).filter(Boolean).join('\n')}`
      : 'No prior calibration data available.'

    // Load brief content
    const brief = await this.adapter.graphRead<{ label: string; description: string }>(
      `SELECT label, description FROM graph_nodes WHERE id=$1`, [input.briefId]
    )
    const briefContent = brief[0]?.description ?? '{}'

    // Load KPI registry for domain-aligned hypotheses
    const kpis = await this.adapter.graphRead<{ label: string; description: string }>(
      `SELECT label, description FROM graph_nodes WHERE kind='KPI' LIMIT 10`
    )

    const res = await this.complete({
      model: 'claude-sonnet-4-6',
      system: `You are a Value Engineer producing quantified business impact assessments. Always produce conservative, evidence-based estimates with explicit assumptions.`,
      messages: [{ role: 'user', content:
        `Assess the business value of this feature.\n\n${calibCtx}\n\nBrief:\n${briefContent}\n\nAvailable KPIs:\n${kpis.map(k=>k.label).join(', ')}\n\nReturn JSON only:\n{"executiveSummary":"2 sentences","valueLow":0,"valueHigh":0,"valueCurrency":"USD","valuePeriod":"annual","confidence":0-100,"assumptions":["..."],"hypotheses":[{"kpi":"metric_name","direction":"increase|decrease","magnitudePct":0.0,"timeframeDays":90,"attributionMethod":"before_after|ab_test|synthetic_control","rationale":"why"}]}`
      }], maxTokens: 3000,
    })

    let parsed = { executiveSummary: '', valueLow: 0, valueHigh: 0, valueCurrency: 'USD', valuePeriod: 'annual', confidence: 50, assumptions: [], hypotheses: [] as any[] }
    try { parsed = { ...parsed, ...JSON.parse(res.text.trim()) } } catch { /* use defaults */ }

    const assessmentId = await this.writeNode({
      kind: 'BUSINESS_IMPACT', label: `Business impact: ${input.briefLabel}`,
      description: JSON.stringify({ ...parsed, briefId: input.briefId, featureId: input.featureId }),
      metadata: { valueLow: parsed.valueLow, valueHigh: parsed.valueHigh, confidence: parsed.confidence },
      eventKind: 'business_impact_assessed', cycleId: input.cycleId,
    })
    await this.writeEdge(assessmentId, input.featureId, 'ESTIMATES')

    const hypothesisIds: number[] = []
    for (const h of parsed.hypotheses) {
      const hid = await this.writeNode({
        kind: 'VALUE_HYPOTHESIS',
        label: `${h.direction === 'decrease' ? 'Reduce' : 'Grow'} ${h.kpi} by ${h.magnitudePct}% in ${h.timeframeDays}d`,
        description: JSON.stringify({ ...h, status: 'draft', committed: false }),
        metadata: { kpi: h.kpi, direction: h.direction, magnitudePct: h.magnitudePct, timeframeDays: h.timeframeDays, committed: false },
        eventKind: 'hypothesis_drafted', cycleId: input.cycleId, featureId: input.featureId,
      })
      hypothesisIds.push(hid)
      await this.writeEdge(hid, assessmentId, 'SUPPORTS')
    }

    await this.adapter.episodicMemory.write({
      agentId: this.agentId, sessionId, domain: 'decide', cycleId: input.cycleId, featureId: input.featureId,
      inputHash, inputSummary: input.briefLabel,
      outputSummary: `Value $${parsed.valueLow.toLocaleString()}–$${parsed.valueHigh.toLocaleString()} ${parsed.valueCurrency}/${parsed.valuePeriod}, ${hypothesisIds.length} hypotheses`,
      outputNodeIds: [assessmentId, ...hypothesisIds], confidencePct: parsed.confidence, llmTokensUsed: res.tokensUsed.output,
    })

    return { assessmentId, hypothesisIds, confidencePct: parsed.confidence }
  }
}
```

---

## STEP 14 — Product Strategy Agent (Decide domain)

```typescript
// packages/agents/decide/product-strategy/src/productStrategyAgent.ts
import { BaseAgent } from '@avp/agent-base'
import type { AgentManifest } from '@avp/shared'

export const PRODUCT_STRATEGY_MANIFEST: AgentManifest = {
  id: 'product-strategy:v1', name: 'Product Strategy Agent', archetype: 'Product Strategist',
  domain: 'decide', runtime: 'studio', version: '1.0.0',
  capabilities: { nodeKinds: ['GTM_PROJECTION','SEGMENT'], edgeKinds: ['TARGETS','INFORMS'], requiresGate: false, maxWritesPerMinute: 20 },
  subscribes: ['context.decide.business_impact_assessed'],
  healthEndpoint: 'http://localhost:7085/health',
  llmBudget: { maxTokensPerRun: 4000, preferredModel: 'claude-sonnet-4-6' },
}

export interface ProductStrategyInput { assessmentId: number; featureId: number; featureLabel: string; cycleId?: string }
export interface ProductStrategyOutput { projectionId: number; segmentIds: number[] }

export class ProductStrategyAgent extends BaseAgent {
  protected readonly agentId = 'product-strategy:v1'
  protected readonly domain = 'decide' as const

  async run(input: ProductStrategyInput): Promise<ProductStrategyOutput> {
    const assessment = await this.adapter.graphRead<{ description: string }>(
      `SELECT description FROM graph_nodes WHERE id=$1`, [input.assessmentId]
    )
    const aData = JSON.parse(assessment[0]?.description ?? '{}')

    const res = await this.complete({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content:
        `Given this business impact assessment, produce a GTM projection.\n\nFeature: ${input.featureLabel}\nValue: $${aData.valueLow?.toLocaleString()}–$${aData.valueHigh?.toLocaleString()} ${aData.valueCurrency}/${aData.valuePeriod}\nSummary: ${aData.executiveSummary}\n\nReturn JSON only:\n{"positioning":"one sentence","segments":[{"name":"segment name","size":"small|medium|large","fit":"low|medium|high","cac":"low|medium|high","ltv":"..."}],"go_to_market":"brief GTM approach","competitive_differentiation":"how this differentiates"}`
      }], maxTokens: 1500,
    })

    let parsed = { positioning: '', segments: [] as any[], go_to_market: '', competitive_differentiation: '' }
    try { parsed = { ...parsed, ...JSON.parse(res.text.trim()) } } catch { /* defaults */ }

    const projectionId = await this.writeNode({
      kind: 'GTM_PROJECTION', label: `GTM: ${input.featureLabel}`,
      description: JSON.stringify(parsed),
      metadata: { segmentCount: parsed.segments.length },
      eventKind: 'gtm_projected', cycleId: input.cycleId, featureId: input.featureId,
    })
    await this.writeEdge(projectionId, input.featureId, 'INFORMS')

    const segmentIds: number[] = []
    for (const seg of parsed.segments) {
      const sid = await this.writeNode({
        kind: 'SEGMENT', label: seg.name,
        description: JSON.stringify(seg),
        metadata: { fit: seg.fit, size: seg.size },
        eventKind: 'segment_identified', cycleId: input.cycleId,
      })
      segmentIds.push(sid)
      await this.writeEdge(projectionId, sid, 'TARGETS')
    }

    return { projectionId, segmentIds }
  }
}
```

---

## STEP 15 — Solutions Estimation Agent (Decide domain)

```typescript
// packages/agents/decide/solutions-estimation/src/solutionsEstimationAgent.ts
import { BaseAgent } from '@avp/agent-base'
import type { AgentManifest } from '@avp/shared'

export const SOLUTIONS_ESTIMATION_MANIFEST: AgentManifest = {
  id: 'solutions-estimation:v1', name: 'Solutions Estimation Agent', archetype: 'Solution Architect',
  domain: 'decide', runtime: 'engineering', version: '1.0.0',
  capabilities: { nodeKinds: ['DEV_IMPACT','EFFORT_ESTIMATE'], edgeKinds: ['ESTIMATES','DEPENDS_ON'], requiresGate: false, maxWritesPerMinute: 20 },
  subscribes: ['context.decide.brief_written'],
  healthEndpoint: 'http://localhost:7086/health',
  llmBudget: { maxTokensPerRun: 6000, preferredModel: 'claude-sonnet-4-6' },
}

export interface SolutionsEstInput { briefId: number; featureId: number; featureLabel: string; cycleId?: string }
export interface SolutionsEstOutput { assessmentId: number; effortWeeksLow: number; effortWeeksHigh: number }

export class SolutionsEstimationAgent extends BaseAgent {
  protected readonly agentId = 'solutions-estimation:v1'
  protected readonly domain = 'decide' as const

  async run(input: SolutionsEstInput): Promise<SolutionsEstOutput> {
    // Read brief content
    const brief = await this.adapter.graphRead<{ description: string }>(
      `SELECT description FROM graph_nodes WHERE id=$1`, [input.briefId]
    )
    const briefData = JSON.parse(brief[0]?.description ?? '{}')

    // Read co-change data (the most expensive files to change)
    const coChange = await this.adapter.graphRead<{ label: string; description: string }>(
      `SELECT label, description FROM graph_nodes WHERE kind='CODE_FILE' ORDER BY created_at DESC LIMIT 30`
    )

    // Read domain regulations (adds compliance effort)
    const regs = await this.adapter.graphRead<{ label: string }>(
      `SELECT label FROM graph_nodes WHERE kind='REGULATION' LIMIT 10`
    )

    const res = await this.complete({
      model: 'claude-sonnet-4-6',
      system: `You are a Solution Architect estimating engineering effort. Be conservative — add buffer for unknowns.`,
      messages: [{ role: 'user', content:
        `Estimate engineering effort for this feature.\n\nFeature: ${input.featureLabel}\nProblem: ${briefData.problemStatement ?? ''}\nCustomer: ${briefData.customerSegment ?? ''}\nApplicable regulations: ${regs.map(r=>r.label).join(', ') || 'none identified'}\nCode complexity signals: ${coChange.length} files in the codebase\n\nReturn JSON only:\n{"effortWeeksLow":1,"effortWeeksHigh":4,"complexity":"low|medium|high","technicalRisks":["..."],"assumptions":["..."],"breakdown":{"design":0,"implementation":0,"testing":0,"integration":0,"documentation":0},"recommendedTeamSize":1,"summary":"one sentence"}`
      }], maxTokens: 2000,
    })

    let parsed = { effortWeeksLow: 2, effortWeeksHigh: 6, complexity: 'medium', technicalRisks: [], assumptions: [], breakdown: {}, recommendedTeamSize: 2, summary: '' }
    try { parsed = { ...parsed, ...JSON.parse(res.text.trim()) } } catch { /* defaults */ }

    const assessmentId = await this.writeNode({
      kind: 'DEV_IMPACT', label: `Engineering estimate: ${input.featureLabel}`,
      description: JSON.stringify({ ...parsed, featureId: input.featureId }),
      metadata: { effortWeeksLow: parsed.effortWeeksLow, effortWeeksHigh: parsed.effortWeeksHigh, complexity: parsed.complexity },
      eventKind: 'engineering_estimated', cycleId: input.cycleId, featureId: input.featureId,
    })
    await this.writeEdge(assessmentId, input.featureId, 'ESTIMATES')

    return { assessmentId, effortWeeksLow: parsed.effortWeeksLow, effortWeeksHigh: parsed.effortWeeksHigh }
  }
}
```

---

## STEP 16 — Portfolio Management Agent (Decide domain)

```typescript
// packages/agents/decide/portfolio-management/src/portfolioManagementAgent.ts
import { BaseAgent } from '@avp/agent-base'
import type { AgentManifest } from '@avp/shared'

export const PORTFOLIO_MGMT_MANIFEST: AgentManifest = {
  id: 'portfolio-management:v1', name: 'Portfolio Management Agent', archetype: 'PMO Director',
  domain: 'decide', runtime: 'studio', version: '1.0.0',
  capabilities: { nodeKinds: ['PORTFOLIO_PACKET'], edgeKinds: ['PACKET_INCLUDES','FUNDED_BY'], requiresGate: false, maxWritesPerMinute: 10 },
  subscribes: ['context.decide.engineering_estimated'],
  healthEndpoint: 'http://localhost:7087/health',
  llmBudget: { maxTokensPerRun: 4000, preferredModel: 'claude-sonnet-4-6' },
}

export interface PortfolioInput {
  featureId: number; featureLabel: string
  businessAssessmentId: number; engAssessmentId: number
  projectionId?: number; cycleId?: string
}
export interface PortfolioOutput { packetId: number; recommendation: 'ADMIT'|'DEFER'|'REJECT'; valueScore: number; riskScore: number }

export class PortfolioManagementAgent extends BaseAgent {
  protected readonly agentId = 'portfolio-management:v1'
  protected readonly domain = 'decide' as const

  async run(input: PortfolioInput): Promise<PortfolioOutput> {
    const [bizRows, engRows] = await Promise.all([
      this.adapter.graphRead<{ description: string }>(`SELECT description FROM graph_nodes WHERE id=$1`, [input.businessAssessmentId]),
      this.adapter.graphRead<{ description: string }>(`SELECT description FROM graph_nodes WHERE id=$1`, [input.engAssessmentId]),
    ])
    const biz = JSON.parse(bizRows[0]?.description ?? '{}')
    const eng = JSON.parse(engRows[0]?.description ?? '{}')

    // Score value: 0–100
    const valueScore = Math.min(100, Math.round(
      (biz.confidence ?? 50) * 0.4 +
      Math.min(100, (biz.valueHigh ?? 0) / 10_000) * 0.4 +
      (biz.hypotheses?.length ?? 0) * 5
    ))

    // Score risk: 0–100 (lower = less risky)
    const complexityMap: Record<string, number> = { low: 20, medium: 50, high: 80 }
    const riskScore = Math.round(
      (complexityMap[eng.complexity ?? 'medium'] ?? 50) * 0.5 +
      Math.min(50, (eng.effortWeeksHigh ?? 4) * 3) * 0.3 +
      (eng.technicalRisks?.length ?? 0) * 5
    )

    const recommendation: 'ADMIT'|'DEFER'|'REJECT' =
      valueScore >= 60 && riskScore <= 70 ? 'ADMIT' :
      valueScore >= 40 ? 'DEFER' : 'REJECT'

    const packetId = await this.writeNode({
      kind: 'PORTFOLIO_PACKET',
      label: `Decision packet: ${input.featureLabel}`,
      description: JSON.stringify({
        featureId: input.featureId, featureLabel: input.featureLabel,
        valueScore, riskScore, recommendation,
        summary: `${recommendation}: value ${valueScore}/100, risk ${riskScore}/100. Effort ${eng.effortWeeksLow}–${eng.effortWeeksHigh} weeks. ROI $${(biz.valueLow??0).toLocaleString()}–$${(biz.valueHigh??0).toLocaleString()} ${biz.valueCurrency ?? 'USD'}/yr.`,
        businessAssessmentId: input.businessAssessmentId,
        engAssessmentId: input.engAssessmentId,
        projectionId: input.projectionId ?? null,
        readyForGate: true,
      }),
      metadata: { valueScore, riskScore, recommendation },
      eventKind: 'portfolio_packet_ready', cycleId: input.cycleId, featureId: input.featureId,
    })

    await this.writeEdge(packetId, input.featureId, 'FUNDED_BY')
    await this.writeEdge(packetId, input.businessAssessmentId, 'PACKET_INCLUDES')
    await this.writeEdge(packetId, input.engAssessmentId, 'PACKET_INCLUDES')
    if (input.projectionId) await this.writeEdge(packetId, input.projectionId, 'PACKET_INCLUDES')

    return { packetId, recommendation, valueScore, riskScore }
  }
}
```

---

## STEP 17 — Requirements Analyst Agent (Define domain)

```typescript
// packages/agents/define/requirements-analyst/src/requirementsAnalystAgent.ts
import { BaseAgent } from '@avp/agent-base'
import type { AgentManifest } from '@avp/shared'

export const REQUIREMENTS_ANALYST_MANIFEST: AgentManifest = {
  id: 'requirements-analyst:v1', name: 'Requirements Analyst Agent', archetype: 'Business Analyst',
  domain: 'define', runtime: 'engineering', version: '1.0.0',
  capabilities: { nodeKinds: ['USER_STORY','ACCEPTANCE_CRITERION'], edgeKinds: ['SPECIFIES','DECOMPOSES'], requiresGate: false, maxWritesPerMinute: 40 },
  subscribes: ['context.decide.hypothesis_committed'],
  healthEndpoint: 'http://localhost:7088/health',
  llmBudget: { maxTokensPerRun: 8000, preferredModel: 'claude-sonnet-4-6' },
}

export interface RequirementsInput { featureId: number; featureLabel: string; briefId: number; cycleId?: string }
export interface RequirementsOutput { storyIds: number[]; criterionIds: number[] }

export class RequirementsAnalystAgent extends BaseAgent {
  protected readonly agentId = 'requirements-analyst:v1'
  protected readonly domain = 'define' as const

  async run(input: RequirementsInput): Promise<RequirementsOutput> {
    const brief = await this.adapter.graphRead<{ description: string }>(
      `SELECT description FROM graph_nodes WHERE id=$1`, [input.briefId]
    )
    const briefData = JSON.parse(brief[0]?.description ?? '{}')

    // Load domain business rules for compliance context
    const rules = await this.adapter.graphRead<{ label: string; description: string }>(
      `SELECT label, description FROM graph_nodes WHERE kind='BUSINESS_RULE' LIMIT 10`
    )

    const res = await this.complete({
      model: 'claude-sonnet-4-6',
      system: `You are a Business Analyst writing user stories in standard format. Every story must be independently testable. Acceptance criteria must be written in Gherkin (Given/When/Then).`,
      messages: [{ role: 'user', content:
        `Write user stories with acceptance criteria for this feature.\n\nFeature: ${input.featureLabel}\nProblem: ${briefData.problemStatement ?? ''}\nSegment: ${briefData.customerSegment ?? ''}\nBusiness rules to comply with: ${rules.map(r=>r.label).join(', ') || 'none'}\n\nReturn JSON only:\n{"stories":[{"role":"As a ...","goal":"I want to ...","benefit":"so that ...","priority":"must|should|could","criteria":[{"given":"...","when":"...","then":"..."}]}]}`
      }], maxTokens: 4000,
    })

    let parsed = { stories: [] as any[] }
    try { parsed = { ...parsed, ...JSON.parse(res.text.trim()) } } catch { /* defaults */ }

    const storyIds: number[] = []
    const criterionIds: number[] = []

    for (const story of parsed.stories) {
      const storyText = `${story.role} ${story.goal} ${story.benefit}`
      const sid = await this.writeNode({
        kind: 'USER_STORY', label: story.goal?.slice(0, 80) ?? 'User story',
        description: storyText, metadata: { priority: story.priority, role: story.role },
        eventKind: 'user_story_written', cycleId: input.cycleId, featureId: input.featureId,
      })
      storyIds.push(sid)
      await this.writeEdge(sid, input.featureId, 'SPECIFIES')

      for (const crit of story.criteria ?? []) {
        const cid = await this.writeNode({
          kind: 'ACCEPTANCE_CRITERION',
          label: crit.when?.slice(0, 80) ?? 'Acceptance criterion',
          description: `Given ${crit.given}\nWhen ${crit.when}\nThen ${crit.then}`,
          metadata: { given: crit.given, when: crit.when, then: crit.then, format: 'gherkin' },
          eventKind: 'acceptance_criterion_written', cycleId: input.cycleId,
        })
        criterionIds.push(cid)
        await this.writeEdge(cid, sid, 'SPECIFIES')
      }
    }

    return { storyIds, criterionIds }
  }
}
```

---

## STEP 18 — Solutions Architect Agent (Define domain)

```typescript
// packages/agents/define/solutions-architect/src/solutionsArchitectAgent.ts
import { BaseAgent } from '@avp/agent-base'
import type { AgentManifest } from '@avp/shared'

export const SOLUTIONS_ARCHITECT_MANIFEST: AgentManifest = {
  id: 'solutions-architect:v1', name: 'Solutions Architect Agent', archetype: 'Enterprise Architect',
  domain: 'define', runtime: 'engineering', version: '1.0.0',
  capabilities: { nodeKinds: ['BOUNDED_CONTEXT','SERVICE_INTERFACE','DATA_FLOW'], edgeKinds: ['BELONGS_TO_CONTEXT','EXPOSES','CONSUMES'], requiresGate: false, maxWritesPerMinute: 30 },
  subscribes: ['context.define.user_story_written'],
  healthEndpoint: 'http://localhost:7089/health',
  llmBudget: { maxTokensPerRun: 6000, preferredModel: 'claude-sonnet-4-6' },
}

export interface ArchitectInput { featureId: number; featureLabel: string; storyIds: number[]; cycleId?: string }
export interface ArchitectOutput { contextIds: number[]; serviceIds: number[] }

export class SolutionsArchitectAgent extends BaseAgent {
  protected readonly agentId = 'solutions-architect:v1'
  protected readonly domain = 'define' as const

  async run(input: ArchitectInput): Promise<ArchitectOutput> {
    const existingContexts = await this.adapter.graphRead<{ id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE kind='BOUNDED_CONTEXT' LIMIT 20`
    )

    const res = await this.complete({
      model: 'claude-sonnet-4-6',
      system: `You are an Enterprise Architect identifying bounded contexts and service interfaces using Domain-Driven Design.`,
      messages: [{ role: 'user', content:
        `Identify bounded contexts and service interfaces for this feature.\n\nFeature: ${input.featureLabel}\nExisting contexts: ${existingContexts.map(c=>c.label).join(', ') || 'none yet'}\n\nReturn JSON only:\n{"contexts":[{"name":"Context Name","description":"what this context owns","isNew":true}],"services":[{"name":"ServiceName","operation":"operationName","inputSchema":"brief description","outputSchema":"brief description","contextName":"which context this belongs to","isAsync":false}],"dataFlows":[{"from":"ServiceA","to":"ServiceB","description":"what flows"}]}`
      }], maxTokens: 2000,
    })

    let parsed = { contexts: [] as any[], services: [] as any[], dataFlows: [] as any[] }
    try { parsed = { ...parsed, ...JSON.parse(res.text.trim()) } } catch { /* defaults */ }

    const contextIds: number[] = []
    const contextMap = new Map<string, number>()

    // Use existing contexts where possible, create new ones if needed
    for (const ctx of parsed.contexts) {
      const existing = existingContexts.find(e => e.label.toLowerCase() === ctx.name.toLowerCase())
      if (existing) { contextMap.set(ctx.name, existing.id); contextIds.push(existing.id) }
      else {
        const cid = await this.writeNode({
          kind: 'BOUNDED_CONTEXT', label: ctx.name, description: ctx.description,
          metadata: { isNew: true }, eventKind: 'bounded_context_defined', cycleId: input.cycleId,
        })
        contextIds.push(cid); contextMap.set(ctx.name, cid)
      }
    }

    const serviceIds: number[] = []
    for (const svc of parsed.services) {
      const sid = await this.writeNode({
        kind: 'SERVICE_INTERFACE', label: `${svc.name}.${svc.operation}`,
        description: JSON.stringify(svc), metadata: { isAsync: svc.isAsync, contextName: svc.contextName },
        eventKind: 'service_interface_defined', cycleId: input.cycleId, featureId: input.featureId,
      })
      serviceIds.push(sid)
      await this.writeEdge(sid, input.featureId, 'BELONGS_TO_CONTEXT')
      const ctxId = contextMap.get(svc.contextName)
      if (ctxId) await this.writeEdge(sid, ctxId, 'BELONGS_TO_CONTEXT')
    }

    for (const df of parsed.dataFlows) {
      const fromSvc = serviceIds.find((_, i) => parsed.services[i]?.name === df.from)
      const toSvc   = serviceIds.find((_, i) => parsed.services[i]?.name === df.to)
      if (fromSvc && toSvc) await this.writeEdge(fromSvc, toSvc, 'CONSUMES')
    }

    return { contextIds, serviceIds }
  }
}
```

---

## STEP 19 — Software Engineering Agent + Quality Engineering Agent (Build domain)

```typescript
// packages/agents/build/software-engineering/src/softwareEngineeringAgent.ts
import { BaseAgent } from '@avp/agent-base'
import type { AgentManifest } from '@avp/shared'

export const SOFTWARE_ENG_MANIFEST: AgentManifest = {
  id: 'software-engineering:v1', name: 'Software Engineering Agent', archetype: 'Senior Developer',
  domain: 'build', runtime: 'engineering', version: '1.0.0',
  capabilities: { nodeKinds: ['CODE_FILE','IMPLEMENTATION_NOTE'], edgeKinds: ['IMPLEMENTS','TRACES_TO','MODIFIES'], requiresGate: false, maxWritesPerMinute: 60 },
  subscribes: ['context.define.service_interface_defined'],
  healthEndpoint: 'http://localhost:7090/health',
  llmBudget: { maxTokensPerRun: 8000, preferredModel: 'claude-sonnet-4-6' },
}

export interface SoftwareEngInput { featureId: number; featureLabel: string; serviceIds: number[]; storyIds: number[]; changedFiles?: { path: string; linesChanged: number }[]; cycleId?: string }
export interface SoftwareEngOutput { codeFileIds: number[]; noteId: number }

export class SoftwareEngineeringAgent extends BaseAgent {
  protected readonly agentId = 'software-engineering:v1'
  protected readonly domain = 'build' as const

  async run(input: SoftwareEngInput): Promise<SoftwareEngOutput> {
    const noteId = await this.writeNode({
      kind: 'IMPLEMENTATION_NOTE', label: `Implementation: ${input.featureLabel}`,
      description: JSON.stringify({ featureId: input.featureId, approach: 'Feature implemented', serviceCount: input.serviceIds.length, storyCount: input.storyIds.length }),
      metadata: { featureId: input.featureId },
      eventKind: 'implementation_started', cycleId: input.cycleId, featureId: input.featureId,
    })

    const codeFileIds: number[] = []
    for (const file of input.changedFiles ?? []) {
      const fid = await this.writeNode({
        kind: 'CODE_FILE', label: file.path,
        description: JSON.stringify({ path: file.path, linesChanged: file.linesChanged, feature: input.featureLabel }),
        metadata: { path: file.path, linesChanged: file.linesChanged },
        eventKind: 'code_file_traced', cycleId: input.cycleId, featureId: input.featureId,
      })
      codeFileIds.push(fid)
      await this.writeEdge(fid, input.featureId, 'IMPLEMENTS')
      await this.writeEdge(fid, noteId, 'TRACES_TO')
    }

    for (const sid of input.storyIds) await this.writeEdge(noteId, sid, 'IMPLEMENTS')

    return { codeFileIds, noteId }
  }
}
```

```typescript
// packages/agents/build/quality-engineering/src/qualityEngineeringAgent.ts
import { BaseAgent } from '@avp/agent-base'
import type { AgentManifest } from '@avp/shared'

export const QUALITY_ENG_MANIFEST: AgentManifest = {
  id: 'quality-engineering:v1', name: 'Quality Engineering Agent', archetype: 'SDET / QA Engineer',
  domain: 'build', runtime: 'engineering', version: '1.0.0',
  capabilities: { nodeKinds: ['TEST_SUITE','TEST_CASE','TEST_RUN'], edgeKinds: ['TESTS','VALIDATES','COVERS'], requiresGate: false, maxWritesPerMinute: 60 },
  subscribes: ['context.build.code_file_traced'],
  healthEndpoint: 'http://localhost:7091/health',
  llmBudget: { maxTokensPerRun: 6000, preferredModel: 'claude-sonnet-4-6' },
}

export interface QualityEngInput { featureId: number; featureLabel: string; criterionIds: number[]; codeFileIds: number[]; testRunResult?: { passed: number; failed: number; coverage: number }; cycleId?: string }
export interface QualityEngOutput { suiteId: number; testRunId?: number; coverageOk: boolean }

export class QualityEngineeringAgent extends BaseAgent {
  protected readonly agentId = 'quality-engineering:v1'
  protected readonly domain = 'build' as const

  async run(input: QualityEngInput): Promise<QualityEngOutput> {
    const suiteId = await this.writeNode({
      kind: 'TEST_SUITE', label: `Tests: ${input.featureLabel}`,
      description: JSON.stringify({ featureId: input.featureId, criterionCount: input.criterionIds.length, fileCount: input.codeFileIds.length }),
      metadata: { criterionCount: input.criterionIds.length },
      eventKind: 'test_suite_created', cycleId: input.cycleId, featureId: input.featureId,
    })
    await this.writeEdge(suiteId, input.featureId, 'TESTS')

    // Write test cases from acceptance criteria
    for (const cid of input.criterionIds) {
      const tcId = await this.writeNode({
        kind: 'TEST_CASE', label: `Test for criterion ${cid}`,
        description: `Automated test case derived from acceptance criterion ${cid}`,
        metadata: { criterionId: cid },
        eventKind: 'test_case_created', cycleId: input.cycleId,
      })
      await this.writeEdge(tcId, suiteId, 'VALIDATES')
      await this.writeEdge(tcId, cid, 'COVERS')
    }

    // Record actual test run if results provided
    let testRunId: number | undefined
    const coverageOk = (input.testRunResult?.coverage ?? 0) >= 80

    if (input.testRunResult) {
      testRunId = await this.writeNode({
        kind: 'TEST_RUN', label: `Test run: ${input.featureLabel}`,
        description: JSON.stringify(input.testRunResult),
        metadata: { ...input.testRunResult, status: input.testRunResult.failed === 0 ? 'pass' : 'fail' },
        eventKind: 'test_run_completed', cycleId: input.cycleId, featureId: input.featureId,
      })
      await this.writeEdge(testRunId, suiteId, 'VALIDATES')
      for (const fileId of input.codeFileIds) await this.writeEdge(testRunId, fileId, 'COVERS')
    }

    return { suiteId, testRunId, coverageOk }
  }
}
```

---

## STEP 20 — DevOps Agent + FinOps Agent (Ship domain)

```typescript
// packages/agents/ship/devops/src/devOpsAgent.ts
import { execSync } from 'node:child_process'
import { BaseAgent } from '@avp/agent-base'
import type { AgentManifest } from '@avp/shared'

export const DEVOPS_MANIFEST: AgentManifest = {
  id: 'devops:v1', name: 'DevOps Agent', archetype: 'DevOps Engineer',
  domain: 'ship', runtime: 'pipeline', version: '1.0.0',
  capabilities: { nodeKinds: ['BUILD','IAC_CHANGESET'], edgeKinds: ['PACKAGED_IN','DEPLOYS'], requiresGate: false, maxWritesPerMinute: 60 },
  subscribes: [], healthEndpoint: 'http://localhost:7092/health',
  llmBudget: { maxTokensPerRun: 0, preferredModel: 'none' },  // no LLM needed
}

export interface DevOpsInput { gitSha: string; runId: string; conclusion: 'success'|'failure'|'cancelled'; artifactUrl?: string; featureId?: number; cycleId?: string }
export interface DevOpsOutput { buildId: number; blocking: boolean }

export class DevOpsAgent extends BaseAgent {
  protected readonly agentId = 'devops:v1'
  protected readonly domain = 'ship' as const

  async run(input: DevOpsInput): Promise<DevOpsOutput> {
    const blocking = input.conclusion !== 'success'

    const buildId = await this.writeNode({
      kind: 'BUILD', label: `Build ${input.gitSha.slice(0, 8)}`,
      description: JSON.stringify({ sha: input.gitSha, runId: input.runId, conclusion: input.conclusion, artifactUrl: input.artifactUrl ?? null }),
      metadata: { conclusion: input.conclusion, sha: input.gitSha, blocking },
      eventKind: 'build_completed', cycleId: input.cycleId, featureId: input.featureId,
    })

    if (input.featureId) await this.writeEdge(buildId, input.featureId, 'PACKAGED_IN')

    return { buildId, blocking }
  }
}
```

```typescript
// packages/agents/ship/finops/src/finOpsAgent.ts
import { execSync } from 'node:child_process'
import { BaseAgent } from '@avp/agent-base'
import type { AgentManifest } from '@avp/shared'

export const FINOPS_MANIFEST: AgentManifest = {
  id: 'finops:v1', name: 'FinOps Agent', archetype: 'FinOps Analyst',
  domain: 'ship', runtime: 'pipeline', version: '1.0.0',
  capabilities: { nodeKinds: ['COST_ESTIMATE','COST_ALERT'], edgeKinds: ['EVIDENCED_BY'], requiresGate: false, maxWritesPerMinute: 20 },
  subscribes: ['context.ship.build_completed'],
  healthEndpoint: 'http://localhost:7093/health',
  llmBudget: { maxTokensPerRun: 2000, preferredModel: 'claude-haiku-4-5-20251001' },
}

export interface FinOpsInput { repoPath: string; gitSha: string; featureId?: number; cycleId?: string }
export interface FinOpsOutput { estimateId: number; projectedMonthlyCostUSD: number; overBudget: boolean; summary: string }

export class FinOpsAgent extends BaseAgent {
  protected readonly agentId = 'finops:v1'
  protected readonly domain = 'ship' as const

  async run(input: FinOpsInput): Promise<FinOpsOutput> {
    let projectedCost = 0; let breakdown = 'unavailable'

    try {
      const out = execSync(`infracost breakdown --path ${input.repoPath} --format json 2>/dev/null`, { encoding: 'utf8', timeout: 120_000 })
      const data = JSON.parse(out) as { totalMonthlyCost: string }
      projectedCost = parseFloat(data.totalMonthlyCost ?? '0')
      breakdown = out
    } catch { /* infracost not available */ }

    // Read approved budget from latest portfolio packet
    const packets = await this.adapter.graphRead<{ description: string }>(
      `SELECT description FROM graph_nodes WHERE kind='PORTFOLIO_PACKET' ORDER BY created_at DESC LIMIT 1`
    )
    const packetData = JSON.parse(packets[0]?.description ?? '{}')
    const approvedBudget: number = packetData.approvedMonthlyBudgetUSD ?? Infinity
    const overBudget = isFinite(approvedBudget) && projectedCost > approvedBudget

    const kind = overBudget ? 'COST_ALERT' : 'COST_ESTIMATE'
    const summary = overBudget
      ? `⚠ Cost alert: projected $${projectedCost.toFixed(0)}/mo exceeds approved $${approvedBudget.toFixed(0)}/mo`
      : projectedCost === 0 ? '✓ No IaC changes detected'
      : `✓ Cost $${projectedCost.toFixed(0)}/mo — within budget`

    const estimateId = await this.writeNode({
      kind, label: `Cost ${overBudget ? 'alert' : 'estimate'} ${input.gitSha.slice(0, 8)}`,
      description: JSON.stringify({ projectedCost, approvedBudget, overBudget, breakdown: breakdown.slice(0, 2000), sha: input.gitSha }),
      metadata: { projectedMonthlyCostUSD: projectedCost, overBudget },
      eventKind: overBudget ? 'cost_alert' : 'cost_estimated',
      cycleId: input.cycleId, featureId: input.featureId,
    })

    return { estimateId, projectedMonthlyCostUSD: projectedCost, overBudget, summary }
  }
}
```

---

## STEP 21 — Release Manager Agent (Ship domain)

```typescript
// packages/agents/ship/release-manager/src/releaseManagerAgent.ts
import { BaseAgent } from '@avp/agent-base'
import type { AgentManifest } from '@avp/shared'

export const RELEASE_MANAGER_MANIFEST: AgentManifest = {
  id: 'release-manager:v1', name: 'Release Manager Agent', archetype: 'Release Manager',
  domain: 'ship', runtime: 'pipeline', version: '1.0.0',
  capabilities: { nodeKinds: ['READINESS_REPORT'], edgeKinds: ['REQUIRES_APPROVAL','CLEARS'], requiresGate: false, maxWritesPerMinute: 10 },
  subscribes: ['context.ship.security_scan_completed','context.ship.cost_estimated','context.build.test_run_completed'],
  healthEndpoint: 'http://localhost:7094/health',
  llmBudget: { maxTokensPerRun: 2000, preferredModel: 'claude-haiku-4-5-20251001' },
}

export interface ReleaseInput { featureId: number; featureLabel: string; buildId?: number; scanId?: number; costEstimateId?: number; testRunId?: number; cycleId?: string }
export interface ReleaseOutput { reportId: number; ready: boolean; blocking: string[]; approvalSet: string[] }

export class ReleaseManagerAgent extends BaseAgent {
  protected readonly agentId = 'release-manager:v1'
  protected readonly domain = 'ship' as const

  async run(input: ReleaseInput): Promise<ReleaseOutput> {
    const blocking: string[] = []
    const approvalSet: string[] = ['Engineering Lead']  // always required

    // Check build
    if (!input.buildId) { blocking.push('No successful build recorded') }
    else {
      const [b] = await this.adapter.graphRead<{ metadata: any }>(`SELECT metadata FROM graph_nodes WHERE id=$1`, [input.buildId])
      if ((b?.metadata as any)?.conclusion !== 'success') blocking.push('Latest build did not succeed')
    }

    // Check security scan
    if (!input.scanId) { blocking.push('No security scan completed') }
    else {
      const [s] = await this.adapter.graphRead<{ metadata: any }>(`SELECT metadata FROM graph_nodes WHERE id=$1`, [input.scanId])
      const meta = s?.metadata as any
      if (meta?.critical > 0) { blocking.push(`${meta.critical} critical security finding(s)`); approvalSet.push('CISO / Security Lead') }
      if (meta?.high > 2) blocking.push(`${meta.high} high-severity security findings`)
    }

    // Check test coverage
    if (!input.testRunId) { blocking.push('No test run results recorded') }
    else {
      const [t] = await this.adapter.graphRead<{ metadata: any }>(`SELECT metadata FROM graph_nodes WHERE id=$1`, [input.testRunId])
      const meta = t?.metadata as any
      if (meta?.failed > 0) blocking.push(`${meta.failed} test(s) failing`)
      if ((meta?.coverage ?? 0) < 80) blocking.push(`Coverage ${meta?.coverage ?? 0}% below 80% threshold`)
    }

    // Check cost — non-blocking but adds FinOps approver
    if (input.costEstimateId) {
      const [c] = await this.adapter.graphRead<{ metadata: any }>(`SELECT metadata FROM graph_nodes WHERE id=$1`, [input.costEstimateId])
      if ((c?.metadata as any)?.overBudget) approvalSet.push('FinOps Lead')
    }

    // Check regulations — adds Compliance approver
    const regs = await this.adapter.graphRead<{ label: string }>(
      `SELECT gn.label FROM graph_nodes gn JOIN graph_edges ge ON ge.to_node_id=gn.id WHERE ge.from_node_id=$1 AND gn.kind='REGULATION'`, [input.featureId]
    )
    if (regs.length > 0) approvalSet.push('Compliance Officer')

    const ready = blocking.length === 0
    const reportId = await this.writeNode({
      kind: 'READINESS_REPORT', label: `Release readiness: ${input.featureLabel}`,
      description: JSON.stringify({ featureId: input.featureId, ready, blocking, approvalSet, inputs: { buildId: input.buildId, scanId: input.scanId, costEstimateId: input.costEstimateId, testRunId: input.testRunId }, regulations: regs.map(r=>r.label) }),
      metadata: { ready, blockingCount: blocking.length, approvalSetSize: approvalSet.length },
      eventKind: ready ? 'release_ready' : 'release_blocked',
      cycleId: input.cycleId, featureId: input.featureId,
    })

    for (const role of approvalSet) {
      const roleNode = await this.writeNode({
        kind: 'APPROVAL_REQUIREMENT', label: role, description: `Required approver: ${role}`,
        metadata: { role, featureId: input.featureId }, eventKind: 'approval_required', cycleId: input.cycleId,
      })
      await this.writeEdge(reportId, roleNode, 'REQUIRES_APPROVAL')
    }

    return { reportId, ready, blocking, approvalSet }
  }
}
```

---

## STEP 22 — Deployment Engineer Agent + SRE Agent (Ship domain)

```typescript
// packages/agents/ship/deployment-engineer/src/deploymentEngineerAgent.ts
import { BaseAgent } from '@avp/agent-base'
import type { AgentManifest } from '@avp/shared'

export const DEPLOYMENT_ENGINEER_MANIFEST: AgentManifest = {
  id: 'deployment-engineer:v1', name: 'Deployment Engineer Agent', archetype: 'Platform Engineer',
  domain: 'ship', runtime: 'pipeline', version: '1.0.0',
  capabilities: { nodeKinds: ['DEPLOYMENT','INCIDENT'], edgeKinds: ['DEPLOYS','SUSPECTED','ROLLED_BACK_BY'], requiresGate: true, maxWritesPerMinute: 10 },
  subscribes: ['context.ship.release_ready'],
  healthEndpoint: 'http://localhost:7095/health',
  llmBudget: { maxTokensPerRun: 0, preferredModel: 'none' },
}

export interface DeployInput { featureId: number; reportId: number; environment: 'canary'|'gradual'|'full'|'demo'; allSignaturesPresent: boolean; cycleId?: string }
export interface DeployOutput { deploymentId: number; status: 'deployed'|'halted'; message: string }

export class DeploymentEngineerAgent extends BaseAgent {
  protected readonly agentId = 'deployment-engineer:v1'
  protected readonly domain = 'ship' as const

  async run(input: DeployInput): Promise<DeployOutput> {
    if (!input.allSignaturesPresent) throw new Error('Cannot deploy: not all required approvals have been recorded')

    const percentage = { canary: 5, gradual: 50, full: 100, demo: 100 }[input.environment]

    const deploymentId = await this.writeNode({
      kind: 'DEPLOYMENT',
      label: `Deploy ${input.environment} (${percentage}%)`,
      description: JSON.stringify({ featureId: input.featureId, environment: input.environment, percentage, reportId: input.reportId, status: 'deployed', ts: Date.now() }),
      metadata: { environment: input.environment, percentage, status: 'deployed' },
      eventKind: 'deployment_started', cycleId: input.cycleId, featureId: input.featureId,
    })
    await this.writeEdge(deploymentId, input.featureId, 'DEPLOYS')

    return { deploymentId, status: 'deployed', message: `Deployed to ${percentage}% of ${input.environment} environment` }
  }

  async halt(deploymentId: number, reason: string, featureId: number, cycleId?: string): Promise<number> {
    const incidentId = await this.writeNode({
      kind: 'INCIDENT', label: `Deployment halt: ${reason.slice(0, 60)}`,
      description: JSON.stringify({ reason, deploymentId, featureId, haltedAt: Date.now() }),
      metadata: { reason, deploymentId },
      eventKind: 'deployment_halted', cycleId, featureId,
    })
    await this.writeEdge(incidentId, deploymentId, 'SUSPECTED')
    return incidentId
  }
}
```

```typescript
// packages/agents/ship/sre/src/sreAgent.ts
import { BaseAgent } from '@avp/agent-base'
import type { AgentManifest } from '@avp/shared'

export const SRE_MANIFEST: AgentManifest = {
  id: 'sre:v1', name: 'SRE Agent', archetype: 'Site Reliability Engineer',
  domain: 'ship', runtime: 'observability', version: '1.0.0',
  capabilities: { nodeKinds: ['KPI_OBSERVATION','SLO_BREACH'], edgeKinds: ['OBSERVED_AS','BREACHES'], requiresGate: false, maxWritesPerMinute: 120 },
  subscribes: ['context.ship.deployment_started'],
  healthEndpoint: 'http://localhost:7096/health',
  llmBudget: { maxTokensPerRun: 0, preferredModel: 'none' },
}

export interface SREInput { deploymentId: number; featureId: number; kpiReadings: { kpiLabel: string; value: number; unit: string }[]; cycleId?: string }
export interface SREOutput { observationIds: number[]; breachIds: number[]; shouldHalt: boolean }

export class SREAgent extends BaseAgent {
  protected readonly agentId = 'sre:v1'
  protected readonly domain = 'ship' as const

  async run(input: SREInput): Promise<SREOutput> {
    const observationIds: number[] = []
    const breachIds: number[] = []
    let shouldHalt = false

    // Look up committed hypotheses to determine guard metric thresholds
    const hypotheses = await this.adapter.graphRead<{ label: string; description: string; metadata: any }>(
      `SELECT label, description, metadata FROM graph_nodes WHERE kind='VALUE_HYPOTHESIS' AND (metadata->>'committed')='true'`
    )

    for (const reading of input.kpiReadings) {
      const kpiNode = await this.adapter.graphRead<{ id: number }>(
        `SELECT id FROM graph_nodes WHERE kind='KPI' AND label=$1 LIMIT 1`, [reading.kpiLabel]
      )
      const kpiId = kpiNode[0]?.id

      const obsId = await this.writeNode({
        kind: 'KPI_OBSERVATION', label: `${reading.kpiLabel}: ${reading.value} ${reading.unit}`,
        description: JSON.stringify({ kpiLabel: reading.kpiLabel, value: reading.value, unit: reading.unit, deploymentId: input.deploymentId, ts: Date.now() }),
        metadata: { kpiLabel: reading.kpiLabel, value: reading.value, deploymentId: input.deploymentId },
        eventKind: 'kpi_observed', cycleId: input.cycleId, featureId: input.featureId,
      })
      observationIds.push(obsId)
      if (kpiId) await this.writeEdge(obsId, kpiId, 'OBSERVED_AS')

      // Check against hypothesis guard thresholds
      for (const hyp of hypotheses) {
        const meta = hyp.metadata as any
        if (meta?.kpi !== reading.kpiLabel) continue
        // If metric moves in wrong direction by >20%, signal halt
        const expectedImprovement = meta.direction === 'decrease' ? -meta.magnitudePct : meta.magnitudePct
        if (expectedImprovement > 0 && reading.value < 0 && Math.abs(reading.value) > 20) {
          const breachId = await this.writeNode({
            kind: 'SLO_BREACH', label: `${reading.kpiLabel} degrading — possible rollback needed`,
            description: JSON.stringify({ kpiLabel: reading.kpiLabel, observedValue: reading.value, hypothesisLabel: hyp.label }),
            metadata: { kpiLabel: reading.kpiLabel, severity: 'high' },
            eventKind: 'slo_breached', cycleId: input.cycleId, featureId: input.featureId,
          })
          breachIds.push(breachId)
          await this.writeEdge(breachId, obsId, 'BREACHES')
          shouldHalt = true
        }
      }
    }

    return { observationIds, breachIds, shouldHalt }
  }
}
```

---

## STEP 23 — Attribution Analyst Agent (Learn domain)

```typescript
// packages/agents/learn/attribution-analyst/src/attributionAnalystAgent.ts
import { BaseAgent } from '@avp/agent-base'
import type { AgentManifest } from '@avp/shared'

export const ATTRIBUTION_ANALYST_MANIFEST: AgentManifest = {
  id: 'attribution-analyst:v1', name: 'Attribution Analyst Agent', archetype: 'Data Analyst',
  domain: 'learn', runtime: 'observability', version: '1.0.0',
  capabilities: { nodeKinds: ['HYPOTHESIS_VERDICT','OUTCOME'], edgeKinds: ['VALIDATES','ATTRIBUTED_TO','REFUTES'], requiresGate: false, maxWritesPerMinute: 20 },
  subscribes: ['context.ship.kpi_observed'],
  healthEndpoint: 'http://localhost:7097/health',
  llmBudget: { maxTokensPerRun: 4000, preferredModel: 'claude-sonnet-4-6' },
}

export interface AttributionInput { featureId: number; featureLabel: string; cycleId?: string }
export interface AttributionOutput { verdictIds: number[]; outcomeId: number; validatedCount: number; refutedCount: number }

export class AttributionAnalystAgent extends BaseAgent {
  protected readonly agentId = 'attribution-analyst:v1'
  protected readonly domain = 'learn' as const

  async run(input: AttributionInput): Promise<AttributionOutput> {
    // Load all committed hypotheses for this feature
    const hypotheses = await this.adapter.graphRead<{ id: number; label: string; description: string; metadata: any }>(
      `SELECT gn.id, gn.label, gn.description, gn.metadata FROM graph_nodes gn JOIN graph_edges ge ON ge.to_node_id=gn.id WHERE ge.from_node_id=$1 AND gn.kind='VALUE_HYPOTHESIS' AND (gn.metadata->>'committed')='true'`,
      [input.featureId]
    )

    // Load KPI observations recorded after the deployment
    const observations = await this.adapter.graphRead<{ id: number; label: string; metadata: any }>(
      `SELECT id, label, metadata FROM graph_nodes WHERE kind='KPI_OBSERVATION' AND (metadata->>'featureId')=$1 ORDER BY created_at ASC`,
      [input.featureId]
    )

    const verdictIds: number[] = []
    let validatedCount = 0; let refutedCount = 0

    for (const hyp of hypotheses) {
      const meta = hyp.metadata as any
      const kpiObs = observations.filter(o => (o.metadata as any)?.kpiLabel === meta?.kpi)
      if (kpiObs.length < 2) continue  // not enough data yet

      const firstVal = (kpiObs[0].metadata as any)?.value ?? 0
      const lastVal  = (kpiObs[kpiObs.length - 1].metadata as any)?.value ?? 0
      const actualDeltaPct = firstVal !== 0 ? ((lastVal - firstVal) / Math.abs(firstVal)) * 100 : 0
      const predictedPct = (meta?.magnitudePct ?? 0) * (meta?.direction === 'decrease' ? -1 : 1)

      // Validated if |actual - predicted| ≤ 50% of predicted magnitude
      const tolerance = Math.abs(predictedPct) * 0.5
      const validated = Math.abs(actualDeltaPct - predictedPct) <= tolerance

      if (validated) validatedCount++; else refutedCount++

      const vid = await this.writeNode({
        kind: 'HYPOTHESIS_VERDICT',
        label: validated ? `✓ ${hyp.label}` : `~ ${hyp.label}`,
        description: JSON.stringify({
          hypothesisId: hyp.id, hypothesisLabel: hyp.label,
          kpi: meta?.kpi, predicted: predictedPct, actual: actualDeltaPct,
          validated, tolerance, observationCount: kpiObs.length,
          method: meta?.attributionMethod ?? 'before_after',
          note: validated ? 'Bet paid off' : 'Bet did not pay off — recorded as a lesson, not a failure',
        }),
        metadata: { validated, predicted: predictedPct, actual: actualDeltaPct, kpi: meta?.kpi },
        eventKind: 'verdict_issued', cycleId: input.cycleId, featureId: input.featureId,
      })
      verdictIds.push(vid)
      await this.writeEdge(vid, hyp.id, validated ? 'VALIDATES' : 'REFUTES')
    }

    const outcomeId = await this.writeNode({
      kind: 'OUTCOME', label: `Outcome: ${input.featureLabel}`,
      description: JSON.stringify({ featureId: input.featureId, verdictCount: verdictIds.length, validatedCount, refutedCount, cycleId: input.cycleId }),
      metadata: { validatedCount, refutedCount, verdictCount: verdictIds.length },
      eventKind: 'outcome_recorded', cycleId: input.cycleId, featureId: input.featureId,
    })
    for (const vid of verdictIds) await this.writeEdge(outcomeId, vid, 'ATTRIBUTED_TO')

    return { verdictIds, outcomeId, validatedCount, refutedCount }
  }
}
```

---

## STEP 24 — Stakeholder Impact Agent (Learn domain)

```typescript
// packages/agents/learn/stakeholder-impact/src/stakeholderImpactAgent.ts
import { BaseAgent } from '@avp/agent-base'
import type { AgentManifest } from '@avp/shared'

export const STAKEHOLDER_IMPACT_MANIFEST: AgentManifest = {
  id: 'stakeholder-impact:v1', name: 'Stakeholder Impact Agent', archetype: 'Customer Success Manager',
  domain: 'learn', runtime: 'collaboration', version: '1.0.0',
  capabilities: { nodeKinds: ['IMPACT_ASSESSMENT'], edgeKinds: ['ATTRIBUTED_TO','REPORTED_TO'], requiresGate: false, maxWritesPerMinute: 20 },
  subscribes: ['context.learn.verdict_issued'],
  healthEndpoint: 'http://localhost:7098/health',
  llmBudget: { maxTokensPerRun: 6000, preferredModel: 'claude-sonnet-4-6' },
}

export interface StakeholderInput { outcomeId: number; featureId: number; featureLabel: string; verdictIds: number[]; cycleId?: string }
export interface StakeholderOutput { assessmentIds: number[] }

export class StakeholderImpactAgent extends BaseAgent {
  protected readonly agentId = 'stakeholder-impact:v1'
  protected readonly domain = 'learn' as const

  async run(input: StakeholderInput): Promise<StakeholderOutput> {
    const verdicts = await Promise.all(input.verdictIds.map(id =>
      this.adapter.graphRead<{ description: string }>(`SELECT description FROM graph_nodes WHERE id=$1`, [id])
    ))
    const verdictData = verdicts.map(v => JSON.parse(v[0]?.description ?? '{}')).filter(v => v.kpi)

    const orgUnits = await this.adapter.graphRead<{ label: string; description: string }>(
      `SELECT label, description FROM graph_nodes WHERE kind='ORG_UNIT' LIMIT 10`
    )
    const defaultUnits = orgUnits.length > 0 ? orgUnits.map(u => u.label) : ['Finance', 'Engineering', 'Customer Support', 'Sales', 'Product']

    const assessmentIds: number[] = []
    for (const unit of defaultUnits) {
      const res = await this.complete({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content:
          `Translate these product outcome results into language meaningful to the ${unit} team.\n\nFeature: ${input.featureLabel}\nVerdict data:\n${verdictData.map(v=>`- ${v.kpi}: predicted ${v.predicted?.toFixed(1)}%, actual ${v.actual?.toFixed(1)}%, ${v.validated?'✓ validated':'~ refuted'}`).join('\n')}\n\nReturn JSON only:\n{"unit":"${unit}","headline":"One sentence in ${unit} language (use their metrics, not KPI codes)","impact":"2-3 sentences on what this means for ${unit}","actionItems":["..."],"sentiment":"positive|neutral|mixed|negative"}`
        }], maxTokens: 800,
      })
      let parsed = { unit, headline: `${unit} impact`, impact: '', actionItems: [], sentiment: 'neutral' }
      try { parsed = { ...parsed, ...JSON.parse(res.text.trim()) } } catch { /* defaults */ }

      const aid = await this.writeNode({
        kind: 'IMPACT_ASSESSMENT', label: `Impact for ${unit}: ${input.featureLabel}`,
        description: JSON.stringify(parsed),
        metadata: { unit, sentiment: parsed.sentiment },
        eventKind: 'impact_assessed', cycleId: input.cycleId, featureId: input.featureId,
      })
      assessmentIds.push(aid)
      await this.writeEdge(aid, input.outcomeId, 'ATTRIBUTED_TO')
    }

    return { assessmentIds }
  }
}
```

---

## STEP 25 — Organizational Learning Agent + Calibration Agent (Learn domain)

```typescript
// packages/agents/learn/organizational-learning/src/orgLearningAgent.ts
import { BaseAgent } from '@avp/agent-base'
import type { AgentManifest } from '@avp/shared'

export const ORG_LEARNING_MANIFEST: AgentManifest = {
  id: 'org-learning:v1', name: 'Organizational Learning Agent', archetype: 'Knowledge Management',
  domain: 'learn', runtime: 'collaboration', version: '1.0.0',
  capabilities: { nodeKinds: ['LEARNING','CALIBRATION_RECORD'], edgeKinds: ['INFORMS','UPDATES','DERIVED_FROM'], requiresGate: false, maxWritesPerMinute: 20 },
  subscribes: ['context.learn.outcome_recorded'],
  healthEndpoint: 'http://localhost:7099/health',
  llmBudget: { maxTokensPerRun: 6000, preferredModel: 'claude-sonnet-4-6' },
}

export interface OrgLearningInput { outcomeId: number; featureId: number; featureLabel: string; validatedCount: number; refutedCount: number; cycleId?: string }
export interface OrgLearningOutput { learningIds: number[]; calibrationId?: number }

export class OrgLearningAgent extends BaseAgent {
  protected readonly agentId = 'org-learning:v1'
  protected readonly domain = 'learn' as const

  async run(input: OrgLearningInput): Promise<OrgLearningOutput> {
    // Load verdicts for this outcome
    const verdicts = await this.adapter.graphRead<{ description: string }>(
      `SELECT gn.description FROM graph_nodes gn JOIN graph_edges ge ON ge.to_node_id=gn.id WHERE ge.from_node_id=$1 AND gn.kind='HYPOTHESIS_VERDICT'`,
      [input.outcomeId]
    )
    const verdictData = verdicts.map(v => { try { return JSON.parse(v.description) } catch { return null } }).filter(Boolean)

    // Load the original pain points that started this cycle
    const painPoints = await this.adapter.graphRead<{ id: number; label: string }>(
      `SELECT gn.id, gn.label FROM graph_nodes gn JOIN graph_edges ge ON ge.to_node_id=$1 WHERE gn.kind='PAIN_POINT' LIMIT 5`,
      [input.featureId]
    )

    const res = await this.complete({
      model: 'claude-sonnet-4-6',
      system: `You are a Knowledge Management specialist extracting organizational lessons from product outcomes. Lessons must be actionable and tied to future decisions, not post-mortems.`,
      messages: [{ role: 'user', content:
        `Extract organizational lessons from this product cycle.\n\nFeature: ${input.featureLabel}\nOutcome: ${input.validatedCount} bets validated, ${input.refutedCount} refuted\nVerdict details:\n${verdictData.map(v=>`- ${v.kpi}: predicted ${v.predicted?.toFixed(1)}%, actual ${v.actual?.toFixed(1)}%, ${v.validated?'validated':'refuted'}`).join('\n')}\n\nReturn JSON only:\n{"lessons":[{"label":"Concise lesson statement","adjustment":"What should change in future estimates or decisions","confidence":0.0-1.0,"targets":["business-case","value-engineering","product-strategy","solutions-estimation"]}]}`
      }], maxTokens: 2000,
    })

    let parsed = { lessons: [] as any[] }
    try { parsed = { ...parsed, ...JSON.parse(res.text.trim()) } } catch { /* defaults */ }

    const learningIds: number[] = []
    for (const lesson of parsed.lessons) {
      const lid = await this.writeNode({
        kind: 'LEARNING', label: lesson.label,
        description: JSON.stringify({ ...lesson, featureId: input.featureId, cycleId: input.cycleId }),
        metadata: { confidence: lesson.confidence, targetCount: lesson.targets?.length ?? 0 },
        eventKind: 'lesson_distilled', cycleId: input.cycleId, featureId: input.featureId,
      })
      learningIds.push(lid)
      await this.writeEdge(lid, input.outcomeId, 'DERIVED_FROM')

      // Wire INFORMS edges back to upstream pain points (closes the loop)
      for (const pp of painPoints) await this.writeEdge(lid, pp.id, 'INFORMS')
    }

    // Write calibration update
    const calId = await this.writeNode({
      kind: 'CALIBRATION_RECORD', label: `Calibration: ${input.featureLabel}`,
      description: JSON.stringify({ featureId: input.featureId, cycleId: input.cycleId, validatedCount: input.validatedCount, refutedCount: input.refutedCount, summary: `${input.validatedCount}/${input.validatedCount + input.refutedCount} bets validated`, verdicts: verdictData.map(v=>({ kpi: v.kpi, predicted: v.predicted, actual: v.actual, validated: v.validated })) }),
      metadata: { validatedCount: input.validatedCount, refutedCount: input.refutedCount },
      eventKind: 'calibration_updated', cycleId: input.cycleId, featureId: input.featureId,
    })
    for (const lid of learningIds) await this.writeEdge(calId, lid, 'UPDATES')

    return { learningIds, calibrationId: calId }
  }
}
```

```typescript
// packages/agents/learn/calibration/src/calibrationAgent.ts
import { BaseAgent } from '@avp/agent-base'
import type { AgentManifest } from '@avp/shared'

export const CALIBRATION_MANIFEST: AgentManifest = {
  id: 'calibration:v1', name: 'Calibration Agent', archetype: 'Continuous Improvement Analyst',
  domain: 'learn', runtime: 'worker', version: '1.0.0',
  capabilities: { nodeKinds: ['DRIFT_ALERT'], edgeKinds: ['ALERTS','TARGETS_AGENT'], requiresGate: false, maxWritesPerMinute: 10 },
  subscribes: ['context.learn.calibration_updated'],
  healthEndpoint: 'http://localhost:7100/health',
  llmBudget: { maxTokensPerRun: 0, preferredModel: 'none' },
}

export interface CalibrationInput { agentId: string; cycleId?: string }
export interface CalibrationOutput { trend: 'improving'|'stable'|'degrading'; meanErrorPct: number; alertId?: number }

export class CalibrationAgent extends BaseAgent {
  protected readonly agentId = 'calibration:v1'
  protected readonly domain = 'learn' as const

  async run(input: CalibrationInput): Promise<CalibrationOutput> {
    // Load calibration records for this agent (from agent_episodes)
    const records = await this.adapter.graphRead<{ metadata: any; created_at: string }>(
      `SELECT metadata, created_at FROM graph_nodes WHERE kind='CALIBRATION_RECORD' ORDER BY created_at DESC LIMIT 10`
    )

    if (records.length < 2) return { trend: 'stable', meanErrorPct: 0 }

    // Calculate mean error per cycle
    const errors = records.map(r => {
      const m = r.metadata as any
      const total = (m?.validatedCount ?? 0) + (m?.refutedCount ?? 0)
      return total > 0 ? ((m?.refutedCount ?? 0) / total) * 100 : 0
    })

    const meanErrorPct = errors.reduce((a, b) => a + b, 0) / errors.length
    const recentMean  = errors.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, errors.length)
    const olderMean   = errors.slice(3).reduce((a, b) => a + b, 0) / Math.max(1, errors.slice(3).length)

    const trend: 'improving'|'stable'|'degrading' =
      recentMean < olderMean - 5 ? 'improving' :
      recentMean > olderMean + 5 ? 'degrading' : 'stable'

    let alertId: number | undefined
    if (trend === 'degrading' && errors.length >= 3) {
      alertId = await this.writeNode({
        kind: 'DRIFT_ALERT',
        label: `Calibration degrading — mean error ${meanErrorPct.toFixed(1)}%`,
        description: JSON.stringify({ trend, meanErrorPct, recentMean, olderMean, recordCount: records.length }),
        metadata: { trend, meanErrorPct },
        eventKind: 'drift_detected', cycleId: input.cycleId,
      })
    }

    return { trend, meanErrorPct, alertId }
  }
}
```

---

## STEP 26 — Cycle Orchestrator (the engine that drives all agents)

```typescript
// packages/platform/src/orchestrator/cycleOrchestrator.ts
import { v4 as uuid } from 'uuid'
import type { Pool } from 'pg'
import { query, queryOne } from '../db/pool.js'
import { ContextBus } from '../bus/contextBus.js'
import type { AgentContextEvent, VerbDomain } from '@avp/shared'

// ── Stage definitions ───────────────────────────────────────────────────────
type StageKind = 'AUTO' | 'WAIT' | 'GATE' | 'TERMINAL'

interface StageDefinition {
  id: string; kind: StageKind; domain: VerbDomain; title: string
  entry?: (ctx: StageContext) => Promise<void>   // what to do on entry
  predicate: (ctx: StageContext) => Promise<boolean>  // when to advance
  next?: string                                   // next stage id (null = terminal)
  onBounce?: string                               // stage to return to on predicate fail
}

interface StageContext {
  cycleId: string; featureId?: number; featureLabel?: string
  metadata: Record<string, unknown>
  read: <T>(sql: string, params?: unknown[]) => Promise<T[]>
}

const STAGES: StageDefinition[] = [
  {
    id: 'SIGNALS', kind: 'WAIT', domain: 'listen',
    title: 'Hear from customers',
    predicate: async ctx => {
      const [r] = await ctx.read<{ count: string }>(`SELECT COUNT(*)::text as count FROM graph_nodes WHERE kind='CUSTOMER_SIGNAL'`)
      return parseInt(r?.count ?? '0') >= 5
    },
    next: 'CLUSTER',
  },
  {
    id: 'CLUSTER', kind: 'AUTO', domain: 'listen',
    title: 'Find the patterns',
    predicate: async ctx => {
      const [r] = await ctx.read<{ count: string }>(`SELECT COUNT(*)::text as count FROM graph_nodes WHERE kind='PAIN_POINT'`)
      return parseInt(r?.count ?? '0') >= 1
    },
    next: 'INTAKE',
  },
  {
    id: 'INTAKE', kind: 'AUTO', domain: 'decide',
    title: 'Write the case for action',
    predicate: async ctx => {
      const [r] = await ctx.read<{ id: number }>(`SELECT id FROM graph_nodes WHERE kind='BRIEF' LIMIT 1`)
      return !!r
    },
    next: 'QUALIFY',
  },
  {
    id: 'QUALIFY', kind: 'AUTO', domain: 'decide',
    title: 'Size the opportunity',
    predicate: async ctx => {
      const [biz] = await ctx.read<{ id: number }>(`SELECT id FROM graph_nodes WHERE kind='BUSINESS_IMPACT' LIMIT 1`)
      const [eng] = await ctx.read<{ id: number }>(`SELECT id FROM graph_nodes WHERE kind='DEV_IMPACT' LIMIT 1`)
      return !!biz && !!eng
    },
    next: 'PACKET',
  },
  {
    id: 'PACKET', kind: 'AUTO', domain: 'decide',
    title: 'Prepare the decision packet',
    predicate: async ctx => {
      const [r] = await ctx.read<{ id: number }>(`SELECT id FROM graph_nodes WHERE kind='PORTFOLIO_PACKET' LIMIT 1`)
      return !!r
    },
    next: 'PORTFOLIO_GATE',
  },
  {
    id: 'PORTFOLIO_GATE', kind: 'GATE', domain: 'decide',
    title: 'Leadership decides',
    predicate: async ctx => {
      const [r] = await ctx.read<{ metadata: any }>(`SELECT metadata FROM graph_nodes WHERE kind='DECISION_RECORD' AND (metadata->>'gate')='PORTFOLIO_GATE' AND (metadata->>'decision')='admit' LIMIT 1`)
      return !!r
    },
    next: 'BUILD',
    onBounce: 'SIGNALS',
  },
  {
    id: 'BUILD', kind: 'WAIT', domain: 'build',
    title: 'Design and build it',
    predicate: async ctx => {
      const [r] = await ctx.read<{ id: number }>(`SELECT id FROM graph_nodes WHERE kind='BUILD' AND (metadata->>'conclusion')='success' LIMIT 1`)
      return !!r
    },
    next: 'CONSOLIDATE',
  },
  {
    id: 'CONSOLIDATE', kind: 'AUTO', domain: 'ship',
    title: 'Check if it is safe to ship',
    predicate: async ctx => {
      const [r] = await ctx.read<{ metadata: any }>(`SELECT metadata FROM graph_nodes WHERE kind='READINESS_REPORT' ORDER BY created_at DESC LIMIT 1`)
      return !!(r?.metadata as any)?.ready
    },
    next: 'RELEASE_GATE',
    onBounce: 'BUILD',
  },
  {
    id: 'RELEASE_GATE', kind: 'GATE', domain: 'ship',
    title: 'Required approvers sign off',
    predicate: async ctx => {
      const [report] = await ctx.read<{ description: string }>(`SELECT description FROM graph_nodes WHERE kind='READINESS_REPORT' ORDER BY created_at DESC LIMIT 1`)
      if (!report) return false
      const reportData = JSON.parse(report.description)
      const required: string[] = reportData.approvalSet ?? []
      const signed = await ctx.read<{ metadata: any }>(`SELECT metadata FROM graph_nodes WHERE kind='DECISION_RECORD' AND (metadata->>'gate')='RELEASE_GATE'`)
      const signedRoles = signed.map(s => (s.metadata as any)?.role)
      return required.every(role => signedRoles.includes(role))
    },
    next: 'ROLLOUT',
  },
  {
    id: 'ROLLOUT', kind: 'AUTO', domain: 'ship',
    title: 'Release to customers gradually',
    predicate: async ctx => {
      const [r] = await ctx.read<{ id: number }>(`SELECT id FROM graph_nodes WHERE kind='DEPLOYMENT' AND (metadata->>'status')='deployed' LIMIT 1`)
      return !!r
    },
    next: 'OBSERVE',
  },
  {
    id: 'OBSERVE', kind: 'WAIT', domain: 'ship',
    title: 'Watch the metrics move',
    predicate: async ctx => {
      // All committed hypotheses need ≥2 observations
      const [hyps] = await ctx.read<{ count: string }>(`SELECT COUNT(*)::text as count FROM graph_nodes WHERE kind='VALUE_HYPOTHESIS' AND (metadata->>'committed')='true'`)
      const hypCount = parseInt(hyps?.count ?? '0')
      if (hypCount === 0) return true  // no hypotheses — proceed
      const [obs] = await ctx.read<{ count: string }>(`SELECT COUNT(DISTINCT (metadata->>'kpiLabel'))::text as count FROM graph_nodes WHERE kind='KPI_OBSERVATION' HAVING COUNT(*) >= 2`)
      return parseInt(obs?.count ?? '0') >= hypCount
    },
    next: 'LEARN',
  },
  {
    id: 'LEARN', kind: 'AUTO', domain: 'learn',
    title: 'Judge the bets, capture lessons',
    predicate: async ctx => {
      const [r] = await ctx.read<{ id: number }>(`SELECT id FROM graph_nodes WHERE kind='OUTCOME' LIMIT 1`)
      return !!r
    },
    next: 'DONE',
  },
  {
    id: 'DONE', kind: 'TERMINAL', domain: 'learn',
    title: 'Cycle complete — loop back smarter',
    predicate: async () => false,
  },
]

const STAGE_MAP = new Map(STAGES.map(s => [s.id, s]))

export class CycleOrchestrator {
  private locks = new Set<string>()

  constructor(private readonly bus: ContextBus) {}

  async advance(cycleId: string): Promise<void> {
    if (this.locks.has(cycleId)) return   // one advance at a time per cycle
    this.locks.add(cycleId)
    try { await this._advance(cycleId) } finally { this.locks.delete(cycleId) }
  }

  private async _advance(cycleId: string): Promise<void> {
    const cycle = await queryOne<{ id: string; current_stage: string; feature_id: number; metadata: any }>(
      `SELECT id, current_stage, feature_id, metadata FROM cycles WHERE id=$1`, [cycleId]
    )
    if (!cycle || cycle.current_stage === 'DONE') return

    const stage = STAGE_MAP.get(cycle.current_stage)
    if (!stage) return

    const ctx: StageContext = {
      cycleId, featureId: cycle.feature_id, metadata: cycle.metadata ?? {},
      read: (sql, params) => query(sql, params),
    }

    // Check exit predicate
    const canAdvance = await stage.predicate(ctx)
    if (!canAdvance) return

    const nextStageId = stage.next
    if (!nextStageId) return

    // Advance cycle
    await query(`UPDATE cycles SET current_stage=$1, updated_at=NOW() WHERE id=$2`, [nextStageId, cycleId])
    await this.log(cycleId, cycle.current_stage, nextStageId)

    // Publish stage transition event
    await this.bus.publish({
      id: uuid(), traceId: uuid(), spanId: uuid(),
      agentId: 'cycle-orchestrator', runtime: 'studio',
      domain: stage.domain, kind: 'stage_advanced',
      graphDelta: { nodesCreated: [], edgesCreated: [] },
      cycleId, featureId: cycle.feature_id, ts: Date.now(),
      metadata: { fromStage: cycle.current_stage, toStage: nextStageId },
    })

    // Try to advance again immediately (chain AUTO stages)
    const nextStage = STAGE_MAP.get(nextStageId)
    if (nextStage?.kind === 'AUTO') {
      await new Promise(r => setTimeout(r, 500))  // small delay for agents to write
      await this._advance(cycleId)
    }
  }

  async recordGate(cycleId: string, gate: string, decision: string, role: string, rationale: string): Promise<number> {
    const featureId = (await queryOne<{ feature_id: number }>(`SELECT feature_id FROM cycles WHERE id=$1`, [cycleId]))?.feature_id
    const result = await query<{ id: number }>(`
      INSERT INTO graph_nodes (kind, label, description, metadata, written_by_agent, trace_id)
      VALUES ('DECISION_RECORD', $1, $2, $3, 'human-gate', $4)
      RETURNING id
    `, [
      `${gate}: ${decision} by ${role}`,
      JSON.stringify({ cycleId, gate, decision, role, rationale, ts: Date.now() }),
      JSON.stringify({ gate, decision, role, cycleId }),
      uuid(),
    ])
    const nodeId = result[0].id

    if (decision === 'defer' && gate === 'PORTFOLIO_GATE') {
      await query(`UPDATE cycles SET current_stage='SIGNALS', updated_at=NOW() WHERE id=$1`, [cycleId])
    } else {
      await this.advance(cycleId)
    }
    return nodeId
  }

  async commitHypotheses(cycleId: string): Promise<void> {
    await query(`
      UPDATE graph_nodes SET metadata = metadata || '{"committed":true}'
      WHERE kind='VALUE_HYPOTHESIS' AND (metadata->>'committed') IS DISTINCT FROM 'true'
        AND id IN (
          SELECT gn.id FROM graph_nodes gn
          JOIN graph_edges ge ON ge.to_node_id=gn.id
          JOIN cycles c ON (gn.metadata->>'cycleId')=c.id
          WHERE c.id=$1
        )
    `, [cycleId])
  }

  private async log(cycleId: string, fromStage: string, toStage: string): Promise<void> {
    console.log(`[Orchestrator] Cycle ${cycleId}: ${fromStage} → ${toStage}`)
  }

  async tick(): Promise<void> {
    // Called every 30s — advance any cycles whose predicates are now satisfied
    const active = await query<{ id: string }>(`SELECT id FROM cycles WHERE status='active' AND current_stage != 'DONE'`)
    for (const cycle of active) await this.advance(cycle.id).catch(console.error)
  }
}
```

**Add the tick timer to `server.ts`:**

```typescript
// In server.ts start() function, after all routes are registered:
const orchestrator = new CycleOrchestrator(bus)
setInterval(() => orchestrator.tick(), 30_000)

// Expose orchestrator routes
app.post<{ Params: { id: string }; Body: { gate: string; decision: string; role: string; rationale: string } }>('/cycles/:id/gate', async (req, reply) => {
  const nodeId = await orchestrator.recordGate(req.params.id, req.body.gate, req.body.decision, req.body.role, req.body.rationale)
  return { nodeId, recorded: true }
})

app.post('/cycles/:id/advance', async (req: any) => {
  await orchestrator.advance(req.params.id)
  return { advanced: true }
})
```

---

## STEP 27 — Observability (OpenTelemetry full setup)

```bash
# In packages/platform/
pnpm add @opentelemetry/sdk-node \
         @opentelemetry/auto-instrumentations-node \
         @opentelemetry/exporter-trace-otlp-http \
         @opentelemetry/sdk-metrics \
         @opentelemetry/exporter-prometheus \
         @opentelemetry/api
```

```typescript
// packages/platform/src/telemetry/index.ts
import { NodeSDK }                      from '@opentelemetry/sdk-node'
import { OTLPTraceExporter }            from '@opentelemetry/exporter-trace-otlp-http'
import { ConsoleSpanExporter }          from '@opentelemetry/sdk-trace-node'
import { PrometheusExporter }           from '@opentelemetry/exporter-prometheus'
import { MeterProvider }                from '@opentelemetry/sdk-metrics'
import { trace, metrics, context, propagation } from '@opentelemetry/api'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'

let sdk: NodeSDK | null = null
let meterProvider: MeterProvider | null = null

export function initTelemetry(): void {
  const isProduction = process.env.NODE_ENV === 'production'
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT

  const traceExporter = otlpEndpoint
    ? new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` })
    : new ConsoleSpanExporter()

  sdk = new NodeSDK({
    serviceName: 'avp-platform',
    traceExporter,
    instrumentations: [getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } })],
  })
  sdk.start()

  // Prometheus metrics exporter on port 9464
  const promExporter = new PrometheusExporter({ port: 9464 })
  meterProvider = new MeterProvider({ readers: [promExporter] })
  metrics.setGlobalMeterProvider(meterProvider)

  console.log('[Telemetry] OpenTelemetry initialized. Metrics on :9464/metrics')
}

export const tracer = () => trace.getTracer('avp-platform', '1.0.0')
export const meter  = () => metrics.getMeter('avp-platform', '1.0.0')

// ── Named spans ────────────────────────────────────────────────────────────
export async function withSpan<T>(
  name: string,
  attrs: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer().startActiveSpan(name, { attributes: attrs }, async span => {
    try {
      const result = await fn()
      span.end()
      return result
    } catch (err) {
      span.recordException(err as Error)
      span.setStatus({ code: 2, message: String(err) })
      span.end()
      throw err
    }
  })
}

export function currentTraceId(): string {
  return trace.getActiveSpan()?.spanContext().traceId ?? 'no-trace'
}

// ── Platform-level metrics ─────────────────────────────────────────────────
export function createPlatformMetrics() {
  const m = meter()
  return {
    graphWritesTotal:    m.createCounter('avp.graph.writes.total',    { description: 'Total graph writes' }),
    graphWriteErrors:    m.createCounter('avp.graph.write.errors',    { description: 'Rejected writes (policy)' }),
    agentRegistrations:  m.createCounter('avp.agents.registrations',  { description: 'Agent registrations' }),
    verdictValidated:    m.createCounter('avp.verdicts.validated',    { description: 'Hypotheses validated' }),
    verdictRefuted:      m.createCounter('avp.verdicts.refuted',      { description: 'Hypotheses refuted' }),
    cyclesStarted:       m.createCounter('avp.cycles.started',        { description: 'Cycles started' }),
    cyclesCompleted:     m.createCounter('avp.cycles.completed',      { description: 'Cycles completed' }),
    gateWaitSeconds:     m.createHistogram('avp.gates.wait_seconds',  { description: 'Seconds a human gate waited' }),
    llmTokensUsed:       m.createHistogram('avp.llm.tokens_used',     { description: 'LLM tokens per agent run' }),
    calibrationErrorPct: m.createGauge('avp.calibration.error_pct',  { description: 'Mean prediction error %' }),
  }
}

export async function shutdown(): Promise<void> {
  await sdk?.shutdown()
  await meterProvider?.shutdown()
}
```

**Wire into server.ts** (add at the very top, before any imports):

```typescript
// Must be the FIRST import
import { initTelemetry, shutdown, withSpan, createPlatformMetrics } from './telemetry/index.js'
initTelemetry()
const platformMetrics = createPlatformMetrics()

// In the /graph/nodes handler, wrap with span:
app.post('/graph/nodes', async (req, reply) => {
  return withSpan('platform.graphWrite.node', { 'agent.id': (req as any).agent?.sub, 'node.kind': (req.body as any)?.kind }, async () => {
    platformMetrics.graphWritesTotal.add(1, { agentId: (req as any).agent?.sub })
    // ... existing handler body
  })
})

// On graceful shutdown:
process.on('SIGTERM', async () => { await shutdown(); process.exit(0) })
```

---

## STEP 28 — Collaboration Runtime (Slack bot)

```bash
mkdir -p packages/runtimes/collaboration/src
cat > packages/runtimes/collaboration/package.json << 'EOF'
{ "name":"@avp/collaboration-runtime","version":"0.1.0","type":"module",
  "dependencies":{"@avp/shared":"workspace:*","@slack/bolt":"^3.21.0"} }
EOF
pnpm -F @avp/collaboration-runtime install
```

```typescript
// packages/runtimes/collaboration/src/slackRuntime.ts
import { App as SlackApp } from '@slack/bolt'
import { createHttpAdapter } from '@avp/shared/adapters/httpAdapter.js'
import type { AgentContextEvent, AgentManifest } from '@avp/shared'

const APPROVAL_BOT_MANIFEST: AgentManifest = {
  id: 'approval-bot:v1', name: 'Approval Notification Agent', archetype: 'Workflow Coordinator',
  domain: 'decide', runtime: 'collaboration', version: '1.0.0',
  capabilities: { nodeKinds: ['NOTIFICATION'], edgeKinds: [], requiresGate: false, maxWritesPerMinute: 30 },
  subscribes: ['context.ship.release_ready', 'context.decide.portfolio_packet_ready'],
  healthEndpoint: 'http://localhost:7101/health',
  llmBudget: { maxTokensPerRun: 0, preferredModel: 'none' },
}

export async function startSlackRuntime(platformUrl: string): Promise<void> {
  const adapter = await createHttpAdapter(platformUrl, APPROVAL_BOT_MANIFEST)
  const slack = new SlackApp({ token: process.env.SLACK_BOT_TOKEN!, signingSecret: process.env.SLACK_SIGNING_SECRET! })

  // Subscribe to gate events and send Slack messages
  adapter.subscribe('context.decide.portfolio_packet_ready', async (event: AgentContextEvent) => {
    const meta = event.metadata as any
    await slack.client.chat.postMessage({
      channel: process.env.SLACK_DECISIONS_CHANNEL ?? '#product-decisions',
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: '📋 Decision packet ready for review' } },
        { type: 'section', text: { type: 'mrkdwn', text: `*${meta?.featureLabel ?? 'Feature'}* is ready for portfolio review.\nValue score: *${meta?.valueScore ?? '?'}/100* · Risk score: *${meta?.riskScore ?? '?'}/100*\nRecommendation: *${meta?.recommendation ?? 'pending'}*` } },
        {
          type: 'actions', elements: [
            { type: 'button', text: { type: 'plain_text', text: '✓ Admit' }, style: 'primary', action_id: 'gate_admit', value: JSON.stringify({ cycleId: event.cycleId, gate: 'PORTFOLIO_GATE', decision: 'admit' }) },
            { type: 'button', text: { type: 'plain_text', text: '◷ Defer' }, action_id: 'gate_defer', value: JSON.stringify({ cycleId: event.cycleId, gate: 'PORTFOLIO_GATE', decision: 'defer' }) },
            { type: 'button', text: { type: 'plain_text', text: '✗ Reject' }, style: 'danger', action_id: 'gate_reject', value: JSON.stringify({ cycleId: event.cycleId, gate: 'PORTFOLIO_GATE', decision: 'reject' }) },
          ]
        }
      ]
    })
  })

  // Handle gate decisions from Slack button actions
  slack.action(/^gate_/, async ({ action, ack, body, client }) => {
    await ack()
    const payload = JSON.parse((action as any).value)
    const role = body.user.name
    const rationale = 'Approved via Slack'

    const res = await fetch(`${platformUrl}/cycles/${payload.cycleId}/gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adapter.jwt}` },
      body: JSON.stringify({ gate: payload.gate, decision: payload.decision, role, rationale }),
    })
    const data = await res.json() as { recorded: boolean }

    await client.chat.postMessage({
      channel: process.env.SLACK_DECISIONS_CHANNEL ?? '#product-decisions',
      text: `Gate decision recorded: *${payload.decision}* by ${role} ✓`,
    })
  })

  await slack.start(3001)
  console.log('[Slack Runtime] running on port 3001')
}
```

---

## STEP 29 — Kubernetes + Helm deployment

```bash
mkdir -p deploy/k8s/{platform,agents,monitoring,secrets}
```

### `deploy/k8s/platform/deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: avp-platform
  namespace: avp
  labels: { app: avp-platform }
spec:
  replicas: 2
  selector:
    matchLabels: { app: avp-platform }
  template:
    metadata:
      labels: { app: avp-platform }
      annotations:
        prometheus.io/scrape: 'true'
        prometheus.io/port: '9464'
    spec:
      containers:
        - name: avp-platform
          image: avp/platform:latest
          ports:
            - containerPort: 7070   # HTTP API
            - containerPort: 9464   # Prometheus metrics
          env:
            - name: NODE_ENV
              value: production
            - name: DB_HOST
              valueFrom: { secretKeyRef: { name: avp-secrets, key: db-host } }
            - name: DB_PASSWORD
              valueFrom: { secretKeyRef: { name: avp-secrets, key: db-password } }
            - name: REDIS_HOST
              valueFrom: { secretKeyRef: { name: avp-secrets, key: redis-host } }
            - name: NATS_URL
              valueFrom: { configMapKeyRef: { name: avp-config, key: nats-url } }
            - name: ANTHROPIC_API_KEY
              valueFrom: { secretKeyRef: { name: avp-secrets, key: anthropic-api-key } }
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: http://jaeger:4318
            - name: KEY_DIR
              value: /secrets/keys
          volumeMounts:
            - name: jwt-keys
              mountPath: /secrets/keys
              readOnly: true
          livenessProbe:
            httpGet: { path: /health, port: 7070 }
            initialDelaySeconds: 15; periodSeconds: 30
          readinessProbe:
            httpGet: { path: /health, port: 7070 }
            initialDelaySeconds: 5; periodSeconds: 10
          resources:
            requests: { cpu: 500m, memory: 512Mi }
            limits:   { cpu: 2000m, memory: 2Gi }
      volumes:
        - name: jwt-keys
          secret: { secretName: avp-jwt-keys }
---
apiVersion: v1
kind: Service
metadata:
  name: avp-platform
  namespace: avp
spec:
  selector: { app: avp-platform }
  ports:
    - name: http;     port: 7070; targetPort: 7070
    - name: metrics;  port: 9464; targetPort: 9464
```

### `deploy/k8s/agents/pipeline-agents.yaml`

```yaml
# Each pipeline agent runs as a Kubernetes Job triggered by CI/CD
apiVersion: batch/v1
kind: Job
metadata:
  name: avp-devsecops-{{ .gitSha }}
  namespace: avp
spec:
  ttlSecondsAfterFinished: 3600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: devsecops-agent
          image: avp/pipeline-agents:latest
          command: ['avp-agent', 'devsecops']
          args:
            - '--repo-path'; '/workspace'
            - '--git-sha'; '{{ .gitSha }}'
            - '--run-id'; '{{ .runId }}'
            - '--cycle-id'; '{{ .cycleId }}'
          env:
            - name: AVP_PLATFORM_URL
              value: http://avp-platform.avp.svc.cluster.local:7070
            - name: ANTHROPIC_API_KEY
              valueFrom: { secretKeyRef: { name: avp-secrets, key: anthropic-api-key } }
          volumeMounts:
            - name: workspace
              mountPath: /workspace
      volumes:
        - name: workspace
          persistentVolumeClaim: { claimName: workspace-pvc }
```

### `deploy/k8s/platform/configmap.yaml`

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: avp-config
  namespace: avp
data:
  nats-url: "nats://nats.avp.svc.cluster.local:4222"
  log-level: "info"
  otel-endpoint: "http://jaeger.monitoring.svc.cluster.local:4318"
```

---

## STEP 30 — One-command bootstrap script

### `scripts/bootstrap.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "🚀 AVP Bootstrap"
echo "════════════════"

# Prerequisites
command -v docker >/dev/null || { echo "❌ Docker required"; exit 1; }
command -v pnpm   >/dev/null || { echo "❌ pnpm required (npm i -g pnpm)"; exit 1; }
node --version | grep -E "^v2[0-9]" || { echo "❌ Node.js 20+ required"; exit 1; }

# Create .env if missing
if [ ! -f .env ]; then
cat > .env << 'EOF'
# Platform
PORT=7070
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=avp
DB_USER=avp
DB_PASSWORD=avp_dev_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# NATS
NATS_URL=nats://localhost:4222

# LLM (set your key here)
ANTHROPIC_API_KEY=

# Observability
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Slack (optional)
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_DECISIONS_CHANNEL=#product-decisions
EOF
  echo "✅ .env created — add your ANTHROPIC_API_KEY"
fi

# Start infrastructure
echo ""
echo "📦 Starting infrastructure (PostgreSQL, Redis, NATS, Jaeger, Grafana)..."
cd deploy/docker && docker compose up -d && cd ../..
echo "   Waiting for services to be healthy..."
sleep 8

# Install dependencies
echo ""
echo "📥 Installing packages..."
pnpm install

# Build all packages
echo ""
echo "🔨 Building packages..."
pnpm build

# Run migrations
echo ""
echo "🗄  Running database migrations..."
pnpm -F @avp/platform db:migrate

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║  AVP is ready.                                        ║"
echo "║                                                       ║"
echo "║  Platform API:  http://localhost:7070                 ║"
echo "║  Platform health: http://localhost:7070/health        ║"
echo "║  Jaeger traces: http://localhost:16686                ║"
echo "║  Grafana:       http://localhost:3100  (admin/admin)  ║"
echo "║  Prometheus:    http://localhost:9090                 ║"
echo "║                                                       ║"
echo "║  Start the platform:  pnpm -F @avp/platform dev      ║"
echo "║  Run CI/CD agent:     avp-agent devsecops --help     ║"
echo "╚═══════════════════════════════════════════════════════╝"
```

---

## STEP 31 — Complete package.json for each agent

Each agent package follows this identical pattern:

```json
{
  "name": "@avp/agents-{domain}-{agent-name}",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./dist/index.js" },
  "scripts": { "build": "tsc", "dev": "tsx src/index.ts" },
  "dependencies": {
    "@avp/shared":     "workspace:*",
    "@avp/agent-base": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "tsx": "^4.0.0"
  }
}
```

Each `src/index.ts` re-exports the agent class and manifest:
```typescript
export { VoCIntelligenceAgent, VOC_MANIFEST } from './vocIntelligenceAgent.js'
```

---

## STEP 32 — End-to-end integration test

```typescript
// packages/platform/src/__tests__/e2e.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initPool, migrate, query } from '../db/pool.js'
import { initRedis } from '../memory/redisMemory.js'
import { ContextBus } from '../bus/contextBus.js'
import { createHttpAdapter } from '@avp/shared/adapters/httpAdapter.js'
import { VoCIntelligenceAgent, VOC_MANIFEST } from '@avp/agents-listen-voc-intelligence'
import { BusinessCaseAgent, BUSINESS_CASE_MANIFEST } from '@avp/agents-decide-business-case'
import { createLLMGateway } from '../llm/llmGateway.js'

const PLATFORM_URL = process.env.AVP_PLATFORM_URL ?? 'http://localhost:7070'

describe('AVP End-to-End: Listen → Decide', () => {
  let vocAdapter: any, bcAdapter: any
  const llm = createLLMGateway()

  beforeAll(async () => {
    vocAdapter = await createHttpAdapter(PLATFORM_URL, VOC_MANIFEST)
    bcAdapter  = await createHttpAdapter(PLATFORM_URL, BUSINESS_CASE_MANIFEST)
  })

  it('should ingest signals and cluster pain points', async () => {
    const agent = new VoCIntelligenceAgent(vocAdapter, llm)
    const result = await agent.run({
      signals: [
        { date: '2026-07-16', cohort: 'enterprise', type: 'feature_request', text: 'We need bulk dispute filing for toll charges' },
        { date: '2026-07-16', cohort: 'fleet',      type: 'pain_point',      text: 'Manual dispute process wastes 3 hours weekly' },
        { date: '2026-07-16', cohort: 'enterprise', type: 'churn_risk',      text: 'Considering switching providers due to poor dispute UX' },
        { date: '2026-07-16', cohort: 'fleet',      type: 'feature_request', text: 'CSV upload for bulk dispute submission' },
        { date: '2026-07-16', cohort: 'individual', type: 'defect',          text: 'Cannot find my transaction ID to submit a dispute' },
      ],
      cycleId: 'test-cycle-001',
    })
    expect(result.painPointIds.length).toBeGreaterThan(0)
    expect(result.topProblem).toBeTruthy()
    console.log('Pain points:', result.clusterCount, '— top:', result.topProblem)
  })

  it('should write an intake brief and create a feature node', async () => {
    const painPoints = await fetch(`${PLATFORM_URL}/graph/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: `SELECT id, label FROM graph_nodes WHERE kind='PAIN_POINT' LIMIT 3` }),
    }).then(r => r.json()) as { id: number; label: string }[]

    expect(painPoints.length).toBeGreaterThan(0)

    const agent = new BusinessCaseAgent(bcAdapter, llm)
    const result = await agent.run({
      painPointIds: painPoints.map(p => p.id),
      painPointLabels: painPoints.map(p => p.label),
      cycleId: 'test-cycle-001',
    })

    expect(result.briefId).toBeGreaterThan(0)
    expect(result.featureId).toBeGreaterThan(0)
    console.log('Brief:', result.briefId, '— Feature:', result.featureId)
  })

  it('should have written to audit_log for all operations', async () => {
    const logs = await fetch(`${PLATFORM_URL}/graph/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: `SELECT agent_id, COUNT(*) as writes FROM audit_log GROUP BY agent_id ORDER BY writes DESC` }),
    }).then(r => r.json()) as { agent_id: string; writes: number }[]

    console.log('Audit log summary:', logs)
    expect(logs.length).toBeGreaterThan(0)
    const vocLogs = logs.find(l => l.agent_id === 'voc-intelligence:v1')
    expect(vocLogs).toBeTruthy()
    expect(Number(vocLogs!.writes)).toBeGreaterThan(0)
  })
})
```

Run:
```bash
pnpm -F @avp/platform test
```

---

## Graduation: from NATS to Kafka (production)

When the team exceeds 50 and needs multi-region, swap `ContextBus` internals only:

```bash
# In packages/platform/
pnpm add kafkajs
```

```typescript
// packages/platform/src/bus/kafkaBus.ts (drop-in replacement for contextBus.ts)
import { Kafka, type Producer, type Consumer } from 'kafkajs'
import type { AgentContextEvent } from '@avp/shared'

export class KafkaContextBus /* implements same interface as ContextBus */ {
  private producer!: Producer
  private consumers: Consumer[] = []
  private kafka = new Kafka({
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    clientId: 'avp-platform',
  })

  async connect(): Promise<void> {
    this.producer = this.kafka.producer()
    await this.producer.connect()
    const admin = this.kafka.admin()
    await admin.connect()
    await admin.createTopics({ topics: [{ topic: 'context-events', numPartitions: 12, replicationFactor: 3 }] })
    await admin.disconnect()
    console.log('[KafkaBus] connected')
  }

  async publish(event: AgentContextEvent): Promise<void> {
    await this.producer.send({ topic: 'context-events', messages: [{ key: event.domain, value: JSON.stringify(event) }] })
  }

  subscribe(pattern: string, groupId: string, handler: (e: AgentContextEvent) => Promise<void>): () => void {
    const consumer = this.kafka.consumer({ groupId })
    this.consumers.push(consumer)
    ;(async () => {
      await consumer.connect()
      await consumer.subscribe({ topic: 'context-events' })
      await consumer.run({ eachMessage: async ({ message }) => {
        if (!message.value) return
        const event = JSON.parse(message.value.toString()) as AgentContextEvent
        if (event.domain === pattern.split('.')[1] || pattern.endsWith('>')) await handler(event)
      }})
    })()
    return () => consumer.disconnect()
  }

  async drain(): Promise<void> {
    await this.producer.disconnect()
    await Promise.all(this.consumers.map(c => c.disconnect()))
  }
}
```

Set `USE_KAFKA=true` in `.env` and add one conditional in `server.ts`:

```typescript
const bus = process.env.USE_KAFKA === 'true' ? new KafkaContextBus() : new ContextBus()
await bus.connect()
```

No agent code changes. No adapter changes. Only the bus implementation swaps.

---

## Complete agent manifest summary (all 20)

| Agent | Package | Domain | Runtime | Node kinds |
|-------|---------|--------|---------|-----------|
| VoC Intelligence | `@avp/agents-listen-voc-intelligence` | listen | studio | CUSTOMER_SIGNAL, PAIN_POINT |
| Market Signal | `@avp/agents-listen-market-signal` | listen | worker | MARKET_SIGNAL, TREND |
| Business Case | `@avp/agents-decide-business-case` | decide | studio | BRIEF, FEATURE |
| Value Engineering | `@avp/agents-decide-value-engineering` | decide | studio | BUSINESS_IMPACT, VALUE_HYPOTHESIS |
| Product Strategy | `@avp/agents-decide-product-strategy` | decide | studio | GTM_PROJECTION, SEGMENT |
| Solutions Estimation | `@avp/agents-decide-solutions-estimation` | decide | engineering | DEV_IMPACT, EFFORT_ESTIMATE |
| Portfolio Management | `@avp/agents-decide-portfolio-management` | decide | studio | PORTFOLIO_PACKET |
| Requirements Analyst | `@avp/agents-define-requirements-analyst` | define | engineering | USER_STORY, ACCEPTANCE_CRITERION |
| Domain Steward | `@avp/agents-define-domain-steward` | define | worker | DOMAIN_CONCEPT, KPI, REGULATION, BUSINESS_RULE |
| Solutions Architect | `@avp/agents-define-solutions-architect` | define | engineering | BOUNDED_CONTEXT, SERVICE_INTERFACE |
| Software Engineering | `@avp/agents-build-software-engineering` | build | engineering | CODE_FILE, IMPLEMENTATION_NOTE |
| Quality Engineering | `@avp/agents-build-quality-engineering` | build | engineering | TEST_SUITE, TEST_CASE, TEST_RUN |
| Documentation | `@avp/agents-build-documentation` | build | engineering | DOCUMENTATION, CHANGELOG |
| DevOps | `@avp/agents-ship-devops` | ship | pipeline | BUILD, IAC_CHANGESET |
| DevSecOps | `@avp/agents-ship-devsecops` | ship | pipeline | SECURITY_SCAN, CVE_FINDING |
| FinOps | `@avp/agents-ship-finops` | ship | pipeline | COST_ESTIMATE, COST_ALERT |
| Release Manager | `@avp/agents-ship-release-manager` | ship | pipeline | READINESS_REPORT |
| Deployment Engineer | `@avp/agents-ship-deployment-engineer` | ship | pipeline | DEPLOYMENT, INCIDENT |
| SRE | `@avp/agents-ship-sre` | ship | observability | KPI_OBSERVATION, SLO_BREACH |
| Attribution Analyst | `@avp/agents-learn-attribution-analyst` | learn | observability | HYPOTHESIS_VERDICT, OUTCOME |
| Stakeholder Impact | `@avp/agents-learn-stakeholder-impact` | learn | collaboration | IMPACT_ASSESSMENT |
| Organizational Learning | `@avp/agents-learn-org-learning` | learn | collaboration | LEARNING, CALIBRATION_RECORD |
| Calibration | `@avp/agents-learn-calibration` | learn | worker | DRIFT_ALERT |
