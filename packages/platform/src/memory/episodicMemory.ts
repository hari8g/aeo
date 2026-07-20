import { query, queryOne } from '../db/pool.js'
import type { IEpisodicMemory, EpisodeRecord } from '@avp/shared'

export class PostgresEpisodicMemory implements IEpisodicMemory {
  async write(ep: EpisodeRecord): Promise<number> {
    const row = await queryOne<{ id: number }>(
      `
      INSERT INTO agent_episodes
        (agent_id, session_id, domain, cycle_id, feature_id, input_hash,
         input_summary, system_prompt_excerpt, output_summary,
         output_node_ids, confidence_pct, latency_ms, llm_tokens_used)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING id
    `,
      [
        ep.agentId,
        ep.sessionId,
        ep.domain,
        ep.cycleId ?? null,
        ep.featureId ?? null,
        ep.inputHash,
        ep.inputSummary ?? null,
        ep.systemPromptExcerpt?.slice(0, 2000) ?? null,
        ep.outputSummary ?? null,
        ep.outputNodeIds ?? null,
        ep.confidencePct ?? null,
        ep.latencyMs ?? null,
        ep.llmTokensUsed ?? null,
      ],
    )
    return row!.id
  }

  async readSimilar(agentId: string, inputHash: string, limit = 5) {
    return query<EpisodeRecord & { id: number; outcomeLabel?: string }>(
      `
      SELECT ae.*, gn.label AS outcome_label
      FROM agent_episodes ae
      LEFT JOIN graph_nodes gn ON gn.id = ae.outcome_node_id
      WHERE ae.agent_id = $1 AND ae.input_hash = $2
      ORDER BY ae.ts DESC LIMIT $3
    `,
      [agentId, inputHash, limit],
    )
  }

  async linkOutcome(episodeId: number, outcomeNodeId: number): Promise<void> {
    await query(`UPDATE agent_episodes SET outcome_node_id=$1 WHERE id=$2`, [
      outcomeNodeId,
      episodeId,
    ])
  }
}
