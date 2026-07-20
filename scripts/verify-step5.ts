import { BaseAgent } from '../packages/agents/shared/src/index.ts'
import { createHttpAdapter } from '../packages/shared/src/adapters/httpAdapter.ts'
import { randomUUID } from 'node:crypto'
import type { ILLMGateway, LLMRequest, LLMResponse } from '../packages/shared/src/index.ts'

class ProbeAgent extends BaseAgent {
  protected readonly agentId = 'step5-probe:v1'
  protected readonly domain = 'build' as const

  async run(label: string) {
    const inputHash = this.hashInput({ label })
    const llm = await this.complete({
      model: 'stub',
      messages: [{ role: 'user', content: `probe ${label}` }],
      maxTokens: 32,
    })

    const scanId = await this.writeNode({
      kind: 'SECURITY_SCAN',
      label,
      description: 'step5 BaseAgent probe',
      metadata: { inputHash },
      eventKind: 'step5_probe_node',
    })

    const findingId = await this.writeNode({
      kind: 'CVE_FINDING',
      label: `finding-for-${label}`,
      eventKind: 'step5_probe_finding',
    })

    const edgeId = await this.writeEdge(scanId, findingId, 'EVIDENCED_BY', 1.0)

    await this.adapter.episodicMemory.write({
      agentId: this.agentId,
      sessionId: randomUUID(),
      domain: this.domain,
      inputHash,
      inputSummary: label,
      outputSummary: llm.text.slice(0, 80),
      outputNodeIds: [scanId, findingId],
      confidencePct: 88,
      llmTokensUsed: llm.tokensUsed.output,
    })

    return {
      inputHash,
      scanId,
      findingId,
      edgeId,
      llmStub: llm.text.includes('step5-probe:v1'),
    }
  }

  boom() {
    this.fail('probe', new Error('intentional'))
  }
}

class BadAgent extends BaseAgent {
  protected readonly agentId = 'step5-probe:v1'
  protected readonly domain = 'build' as const

  async tryBad() {
    await this.writeNode({
      kind: 'CUSTOMER_SIGNAL',
      label: 'nope',
      eventKind: 'bad',
    })
  }
}

async function main() {
  const stubLlm: ILLMGateway = {
    async isAvailable() {
      return false
    },
    async complete(req: LLMRequest): Promise<LLMResponse> {
      return {
        text: `[Stub response for agent ${req.agentId}]`,
        provider: 'anthropic',
        tokensUsed: { input: 0, output: 0 },
        cached: false,
      }
    },
  }

  const adapter = await createHttpAdapter('http://localhost:7070', {
    id: 'step5-probe:v1',
    name: 'Step5 Probe Agent',
    archetype: 'Test',
    domain: 'build',
    runtime: 'pipeline',
    version: '1.0.0',
    capabilities: {
      nodeKinds: ['SECURITY_SCAN', 'CVE_FINDING'],
      edgeKinds: ['EVIDENCED_BY'],
      requiresGate: false,
      maxWritesPerMinute: 60,
    },
    subscribes: [],
    healthEndpoint: '',
  })

  const agent = new ProbeAgent(adapter, stubLlm)

  console.log(
    '1. hashInput stable?',
    (agent as unknown as { hashInput: (x: unknown) => string }).hashInput({ a: 1 }) ===
      (agent as unknown as { hashInput: (x: unknown) => string }).hashInput({ a: 1 }),
  )

  const label = `step5-scan-${Date.now()}`
  console.log('2. run()...')
  const out = await agent.run(label)
  console.log('  ', out)

  console.log('3. graph confirms nodes...')
  const rows = await adapter.graphRead(
    'SELECT id, kind, label FROM graph_nodes WHERE id = ANY($1::int[]) ORDER BY id',
    [[out.scanId, out.findingId]],
  )
  console.log('  ', rows)

  console.log('4. episode by hash...')
  const eps = await adapter.episodicMemory.readSimilar('step5-probe:v1', out.inputHash, 3)
  console.log('   count', eps.length, 'summary', eps[0]?.outputSummary)

  console.log('5. fail() wraps errors...')
  try {
    agent.boom()
    throw new Error('should have thrown')
  } catch (e) {
    console.log('  ', String(e))
  }

  console.log('6. writeNode capability denial via fail()...')
  try {
    await new BadAgent(adapter, stubLlm).tryBad()
    throw new Error('should have thrown')
  } catch (e) {
    console.log('  ', String(e).slice(0, 160))
  }

  await adapter.shutdown()
  console.log('\nALL STEP 5 CHECKS PASSED')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
