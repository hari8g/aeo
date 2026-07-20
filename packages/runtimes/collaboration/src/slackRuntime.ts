import { App as SlackApp } from '@slack/bolt'
import { createHttpAdapter, HttpRuntimeAdapter } from '@avp/shared/adapters/httpAdapter.js'
import type { AgentContextEvent, AgentManifest } from '@avp/shared'
import { NODE_KINDS } from '@avp/shared'

export const APPROVAL_BOT_MANIFEST: AgentManifest = {
  id: 'approval-bot:v1',
  name: 'Approval Notification Agent',
  archetype: 'Workflow Coordinator',
  domain: 'decide',
  runtime: 'collaboration',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [NODE_KINDS.NOTIFICATION],
    edgeKinds: [],
    requiresGate: false,
    maxWritesPerMinute: 30,
  },
  subscribes: ['context.ship.release_ready', 'context.decide.portfolio_packet_ready'],
  healthEndpoint: 'http://localhost:7101/health',
  llmBudget: { maxTokensPerRun: 0, preferredModel: 'none' },
}

async function notifyPortfolioReady(
  adapter: HttpRuntimeAdapter,
  event: AgentContextEvent,
  post: (text: string, blocks?: unknown[]) => Promise<void>,
): Promise<void> {
  const meta = (event.metadata ?? {}) as Record<string, unknown>
  const text =
    `Decision packet ready: ${meta.featureLabel ?? 'Feature'} ` +
    `(value=${meta.valueScore ?? '?'}, risk=${meta.riskScore ?? '?'}, ` +
    `rec=${meta.recommendation ?? 'pending'}) cycle=${event.cycleId ?? '?'}`

  await post(text, [
    { type: 'header', text: { type: 'plain_text', text: 'Decision packet ready for review' } },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*${meta.featureLabel ?? 'Feature'}* is ready for portfolio review.\n` +
          `Value score: *${meta.valueScore ?? '?'}/100* · Risk score: *${meta.riskScore ?? '?'}/100*\n` +
          `Recommendation: *${meta.recommendation ?? 'pending'}*`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Admit' },
          style: 'primary',
          action_id: 'gate_admit',
          value: JSON.stringify({
            cycleId: event.cycleId,
            gate: 'PORTFOLIO_GATE',
            decision: 'admit',
          }),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Defer' },
          action_id: 'gate_defer',
          value: JSON.stringify({
            cycleId: event.cycleId,
            gate: 'PORTFOLIO_GATE',
            decision: 'defer',
          }),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Reject' },
          style: 'danger',
          action_id: 'gate_reject',
          value: JSON.stringify({
            cycleId: event.cycleId,
            gate: 'PORTFOLIO_GATE',
            decision: 'reject',
          }),
        },
      ],
    },
  ])

  await adapter.graphWrite({
    type: 'upsertNode',
    kind: NODE_KINDS.NOTIFICATION,
    label: `portfolio_gate:${event.cycleId ?? 'unknown'}`,
    description: text,
    metadata: { channel: 'slack-or-stub', eventKind: event.kind },
  })
}

async function postGate(
  platformUrl: string,
  jwt: string,
  payload: { cycleId: string; gate: string; decision: string },
  role: string,
  rationale: string,
): Promise<{ recorded: boolean }> {
  const res = await fetch(`${platformUrl}/cycles/${payload.cycleId}/gate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      gate: payload.gate,
      decision: payload.decision,
      role,
      rationale,
    }),
  })
  return (await res.json()) as { recorded: boolean }
}

/** Dev/CI stub — logs gate notifications without Slack credentials. */
export async function startStubCollaborationRuntime(
  platformUrl: string,
): Promise<HttpRuntimeAdapter> {
  const adapter = await createHttpAdapter(platformUrl, APPROVAL_BOT_MANIFEST)

  const handler = async (event: AgentContextEvent) => {
    console.log('[Collaboration Stub] portfolio_packet_ready', {
      cycleId: event.cycleId,
      metadata: event.metadata,
    })
    await notifyPortfolioReady(adapter, event, async (text) => {
      console.log('[Collaboration Stub] notify:', text)
    })
  }

  adapter.subscribe('context.decide.portfolio_packet_ready', handler)
  adapter.subscribe('context.ship.release_ready', async (event) => {
    console.log('[Collaboration Stub] release_ready', {
      cycleId: event.cycleId,
      metadata: event.metadata,
    })
  })

  console.log('[Collaboration Stub] listening (no Slack tokens) — gate payloads logged only')
  return adapter
}

/** Simulate an inbound bus event for stub/CI verification. */
export async function simulatePortfolioPacketReady(
  adapter: HttpRuntimeAdapter,
  event: Partial<AgentContextEvent> & { cycleId: string },
): Promise<void> {
  const full: AgentContextEvent = {
    id: event.id ?? 'sim-1',
    traceId: event.traceId ?? 'sim-trace',
    spanId: event.spanId ?? 'sim-span',
    agentId: event.agentId ?? 'portfolio-management:v1',
    runtime: event.runtime ?? 'studio',
    domain: 'decide',
    kind: 'portfolio_packet_ready',
    graphDelta: event.graphDelta ?? { nodesCreated: [], edgesCreated: [] },
    cycleId: event.cycleId,
    featureId: event.featureId,
    metadata: event.metadata ?? {
      featureLabel: 'Sim Feature',
      valueScore: 80,
      riskScore: 20,
      recommendation: 'admit',
    },
    ts: Date.now(),
  }
  await adapter.dispatchLocal('context.decide.portfolio_packet_ready', full)
}

export async function startSlackRuntime(platformUrl: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN
  const signingSecret = process.env.SLACK_SIGNING_SECRET
  if (!token || !signingSecret) {
    await startStubCollaborationRuntime(platformUrl)
    return
  }

  const adapter = await createHttpAdapter(platformUrl, APPROVAL_BOT_MANIFEST)
  const slack = new SlackApp({ token, signingSecret })

  adapter.subscribe('context.decide.portfolio_packet_ready', async (event) => {
    await notifyPortfolioReady(adapter, event, async (text, blocks) => {
      await slack.client.chat.postMessage({
        channel: process.env.SLACK_DECISIONS_CHANNEL ?? '#product-decisions',
        text,
        blocks: blocks as never,
      })
    })
  })

  adapter.subscribe('context.ship.release_ready', async (event) => {
    await slack.client.chat.postMessage({
      channel: process.env.SLACK_DECISIONS_CHANNEL ?? '#product-decisions',
      text: `Release ready for cycle ${event.cycleId ?? '?'}`,
    })
  })

  slack.action(/^gate_/, async ({ action, ack, body, client }) => {
    await ack()
    const payload = JSON.parse((action as { value?: string }).value ?? '{}') as {
      cycleId: string
      gate: string
      decision: string
    }
    const role = (body as { user?: { name?: string } }).user?.name ?? 'slack-user'
    const data = await postGate(platformUrl, adapter.jwt, payload, role, 'Approved via Slack')
    await client.chat.postMessage({
      channel: process.env.SLACK_DECISIONS_CHANNEL ?? '#product-decisions',
      text: `Gate decision recorded: *${payload.decision}* by ${role} (${data.recorded ? 'ok' : 'fail'})`,
    })
  })

  await slack.start(3001)
  console.log('[Slack Runtime] running on port 3001')
}
