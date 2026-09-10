import { randomUUID } from 'node:crypto'
import { query, queryOne } from '../db/pool.js'

export type OfficeOwnerId = 'gtm' | 'eni' | 'px' | 'pas'

export type OfficeProgressTopic = {
  label: string
  product: string
  owner: OfficeOwnerId
  phase: 'listen' | 'decide' | 'define' | 'build' | 'ship' | 'learn'
  stage: string
  summary: string
  completedPhases: string[]
  agentId: string
}

export const OFFICE_PROGRESS_TOPICS: OfficeProgressTopic[] = [
  {
    label: 'ATMS — RFQ analysis and bid quotation',
    product: 'ATMS',
    owner: 'gtm',
    phase: 'ship',
    stage: 'CONSOLIDATE',
    summary: 'RFQ analysis and bid-quotation for the ATMS pursuit.',
    completedPhases: ['listen', 'decide', 'define', 'build'],
    agentId: 'release-manager:v1',
  },
  {
    label: 'Reintroduction — Participatory budget meeting',
    product: 'Reintroduction',
    owner: 'eni',
    phase: 'decide',
    stage: 'PACKET',
    summary: 'Participatory budget meeting for the Reintroduction program.',
    completedPhases: ['listen'],
    agentId: 'portfolio-management:v1',
  },
  {
    label: 'Toll.OS — Knowledge graph',
    product: 'Toll.OS',
    owner: 'px',
    phase: 'define',
    stage: 'DEFINE',
    summary: 'Knowledge graph workstream owned by product owners.',
    completedPhases: ['listen', 'decide'],
    agentId: 'domain-steward:v1',
  },
  {
    label: 'StaaS — Validation on features between two git commits',
    product: 'StaaS',
    owner: 'pas',
    phase: 'build',
    stage: 'BUILD',
    summary: 'Validate feature deltas between two git commits.',
    completedPhases: ['listen', 'decide', 'define'],
    agentId: 'quality-engineering:v1',
  },
  {
    label: 'StaaS — Enhancement of knowledge graph from positioning pack',
    product: 'StaaS',
    owner: 'pas',
    phase: 'define',
    stage: 'DEFINE',
    summary: 'Enhance the knowledge graph from the Positioning pack (sales readiness checklist).',
    completedPhases: ['listen', 'decide'],
    agentId: 'requirements-analyst:v1',
  },
]

let lastEnsure = 0

export async function ensureOfficeProgressTopics() {
  const now = Date.now()
  if (now - lastEnsure < 12_000) return

  for (const topic of OFFICE_PROGRESS_TOPICS) {
    const meta = {
      officeTopic: true,
      owner: topic.owner,
      product: topic.product,
      summary: topic.summary,
      completedPhases: topic.completedPhases,
      stage: topic.stage,
      demo: true,
    }

    const row = await queryOne<{ id: number }>(
      `
      INSERT INTO graph_nodes (kind, label, description, metadata)
      VALUES ('FEATURE', $1, $2, $3::jsonb)
      ON CONFLICT (workspace_id, kind, label)
      DO UPDATE SET
        description = EXCLUDED.description,
        metadata = COALESCE(graph_nodes.metadata, '{}'::jsonb) || EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING id
    `,
      [topic.label, topic.summary, JSON.stringify(meta)],
    )
    const featureId = row!.id

    const cycle = await queryOne<{ id: string }>(
      `
      SELECT id FROM cycles
      WHERE feature_id=$1 AND status='active' AND current_stage <> 'DONE'
      LIMIT 1
    `,
      [featureId],
    )
    const cycleMeta = JSON.stringify({
      featureId,
      officeTopic: true,
      owner: topic.owner,
      product: topic.product,
    })
    if (!cycle) {
      await query(
        `
        INSERT INTO cycles (label, workspace_id, current_stage, feature_id, metadata)
        VALUES ($1, 'default', $2, $3, $4::jsonb)
      `,
        [topic.label, topic.stage, featureId, cycleMeta],
      )
    } else {
      await query(
        `
        UPDATE cycles
        SET current_stage=$2, label=$3, metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb, updated_at=NOW()
        WHERE id=$1
      `,
        [cycle.id, topic.stage, topic.label, cycleMeta],
      )
    }

    const recent = await queryOne<{ id: number }>(
      `
      SELECT id FROM agent_episodes
      WHERE feature_id=$1 AND ts > NOW() - INTERVAL '80 seconds'
      LIMIT 1
    `,
      [featureId],
    )
    if (!recent) {
      await query(
        `
        INSERT INTO agent_episodes
          (agent_id, session_id, domain, feature_id, input_hash, input_summary, output_summary)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
        [
          topic.agentId,
          randomUUID(),
          topic.phase,
          featureId,
          `office-topic:${topic.owner}:${featureId}:${Math.floor(now / 60_000)}`,
          topic.summary,
          `In progress · ${topic.product} · ${topic.owner}`,
        ],
      )
    }
  }
  lastEnsure = Date.now()
}
