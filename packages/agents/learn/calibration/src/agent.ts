import { randomUUID } from 'node:crypto'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'
import { NODE_KINDS, EDGE_KINDS } from '@avp/shared'

export interface CalibrationInput {
  targetAgentId: string
  cycleId: string
  predictedValue: number
  actualValue: number
  kpi: string
  featureId?: number
}

export interface CalibrationOutput {
  recordId: number
  alertId?: number
  errorPct: number
}

export const CALIBRATION_MANIFEST: AgentManifest = {
  id: 'calibration:v1',
  name: 'Calibration Agent',
  archetype: 'Calibration Analyst',
  domain: 'learn',
  runtime: 'worker',
  version: '1.0.0',
  capabilities: {
    nodeKinds: [NODE_KINDS.DRIFT_ALERT, NODE_KINDS.CALIBRATION_RECORD],
    edgeKinds: [EDGE_KINDS.CALIBRATES],
    requiresGate: false,
    maxWritesPerMinute: 120,
  },
  subscribes: ['context.learn.verdict_recorded'],
  healthEndpoint: 'http://localhost:7095/health',
  llmBudget: { maxTokensPerRun: 1000, preferredModel: 'claude-haiku-4-5-20251001' },
}

export class CalibrationAgent extends BaseAgent {
  protected readonly agentId = 'calibration:v1'
  protected readonly domain = 'learn' as const

  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) {
    super(adapter, llm)
  }

  async run(input: CalibrationInput): Promise<CalibrationOutput> {
    if (
      !input.targetAgentId ||
      !input.cycleId ||
      input.predictedValue === undefined ||
      input.actualValue === undefined ||
      !input.kpi
    ) {
      this.fail('run', new Error('targetAgentId, cycleId, predictedValue, actualValue, and kpi are required'))
    }

    const sessionId = randomUUID()
    const inputHash = this.hashInput(input)
    const errorPct =
      (Math.abs(input.predictedValue - input.actualValue) /
        Math.max(Math.abs(input.actualValue), 1e-9)) *
      100

    const recordId = await this.writeNode({
      kind: NODE_KINDS.CALIBRATION_RECORD,
      label: `Calibration ${input.targetAgentId} / ${input.kpi}`,
      description: JSON.stringify({
        targetAgentId: input.targetAgentId,
        kpi: input.kpi,
        predictedValue: input.predictedValue,
        actualValue: input.actualValue,
        errorPct,
        cycleId: input.cycleId,
      }),
      metadata: {
        targetAgentId: input.targetAgentId,
        agentId: this.agentId,
        kpi: input.kpi,
        predictedValue: input.predictedValue,
        actualValue: input.actualValue,
        errorPct,
        cycleId: input.cycleId,
        featureId: input.featureId,
      },
      eventKind: 'calibration_written',
      cycleId: input.cycleId,
      featureId: input.featureId,
    })

    if (input.featureId !== undefined) {
      await this.writeEdge(recordId, input.featureId, EDGE_KINDS.CALIBRATES)
    }

    let alertId: number | undefined
    if (errorPct > 25) {
      alertId = await this.writeNode({
        kind: NODE_KINDS.DRIFT_ALERT,
        label: `Drift alert ${input.targetAgentId} / ${input.kpi}`,
        description: JSON.stringify({
          targetAgentId: input.targetAgentId,
          kpi: input.kpi,
          errorPct,
          predictedValue: input.predictedValue,
          actualValue: input.actualValue,
          threshold: 25,
        }),
        metadata: {
          targetAgentId: input.targetAgentId,
          kpi: input.kpi,
          errorPct,
          recordId,
        },
        eventKind: 'drift_detected',
        cycleId: input.cycleId,
        featureId: input.featureId,
      })
      await this.writeEdge(alertId, recordId, EDGE_KINDS.CALIBRATES)
    }

    await this.postCalibration({
      agent_id: input.targetAgentId,
      cycle_id: input.cycleId,
      predicted_value: input.predictedValue,
      actual_value: input.actualValue,
      error_pct: errorPct,
      kpi: input.kpi,
    })

    const outputNodeIds = alertId !== undefined ? [recordId, alertId] : [recordId]

    await this.adapter.episodicMemory.write({
      agentId: this.agentId,
      sessionId,
      domain: 'learn',
      cycleId: input.cycleId,
      featureId: input.featureId,
      inputHash,
      inputSummary: `target=${input.targetAgentId} kpi=${input.kpi}`,
      outputSummary: `errorPct=${errorPct.toFixed(2)}${alertId !== undefined ? ' drift_alert' : ''}`,
      outputNodeIds,
      confidencePct: 100,
    })

    return { recordId, alertId, errorPct }
  }

  private async postCalibration(body: {
    agent_id: string
    cycle_id: string
    predicted_value: number
    actual_value: number
    error_pct: number
    kpi: string
  }): Promise<void> {
    const base = process.env.AVP_PLATFORM_URL ?? 'http://localhost:7070'
    try {
      await fetch(`${base}/calibration`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.adapter.jwt}`,
        },
        body: JSON.stringify(body),
      })
    } catch {
      /* stub-friendly: platform route may not exist yet */
    }
  }
}
