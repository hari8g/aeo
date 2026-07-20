import Anthropic from '@anthropic-ai/sdk'
import type { ILLMGateway, LLMRequest, LLMResponse } from '@avp/shared'

/** Deterministic stub when no LLM provider is configured — never crashes. */
class StubLLMGateway implements ILLMGateway {
  async isAvailable(): Promise<boolean> {
    return false
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    return {
      text: `[Stub response for agent ${req.agentId} — set ANTHROPIC_API_KEY to enable real responses]`,
      provider: 'anthropic',
      tokensUsed: { input: 0, output: 0 },
      cached: false,
    }
  }
}

class AnthropicGateway implements ILLMGateway {
  private client: Anthropic

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      })
      return true
    } catch {
      return false
    }
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const msg = await this.client.messages.create({
      model: req.model || 'claude-sonnet-4-6',
      max_tokens: req.maxTokens ?? 4096,
      system: req.system,
      messages: req.messages,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    })
    return {
      text: msg.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join(''),
      provider: 'anthropic',
      tokensUsed: { input: msg.usage.input_tokens, output: msg.usage.output_tokens },
      cached: false,
    }
  }
}

export function createLLMGateway(): ILLMGateway {
  if (process.env.ANTHROPIC_API_KEY) return new AnthropicGateway()
  console.warn('[LLM] No provider configured — using stub. Set ANTHROPIC_API_KEY to enable.')
  return new StubLLMGateway()
}
