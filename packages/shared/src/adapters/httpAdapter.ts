import { randomUUID } from 'node:crypto'
import type {
  IRuntimeAdapter,
  IWorkingMemory,
  IEpisodicMemory,
  EpisodeRecord,
  GraphWriteOp,
  GraphWriteResult,
  AgentContextEvent,
  RuntimeId,
  VerbDomain,
  AgentManifest,
} from '../index.js'

// ── In-process working memory for external runtimes ────────────────────────
export class InMemoryWorkingMemory implements IWorkingMemory {
  private store = new Map<string, { v: unknown; exp: number }>()

  async get<T>(k: string): Promise<T | undefined> {
    const e = this.store.get(k)
    return !e || Date.now() > e.exp ? undefined : (e.v as T)
  }

  async set<T>(k: string, v: T, ttl = 3600): Promise<void> {
    this.store.set(k, { v, exp: Date.now() + ttl * 1000 })
  }

  async delete(k: string): Promise<void> {
    this.store.delete(k)
  }

  clear(): void {
    this.store.clear()
  }
}

// ── Episodic memory via Platform API ───────────────────────────────────────
class RemoteEpisodicMemory implements IEpisodicMemory {
  constructor(
    private readonly base: string,
    private readonly jwt: string,
  ) {}

  private h(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.jwt}`,
      'Content-Type': 'application/json',
    }
  }

  async write(ep: EpisodeRecord): Promise<number> {
    const r = await fetch(`${this.base}/episodes`, {
      method: 'POST',
      headers: this.h(),
      body: JSON.stringify(ep),
    })
    if (!r.ok) {
      const err = (await r.json().catch(() => ({}))) as { error?: string }
      throw new Error(`[Platform API] episodes write ${r.status}: ${err.error ?? r.statusText}`)
    }
    const d = (await r.json()) as { id: number | string }
    return typeof d.id === 'string' ? parseInt(d.id, 10) : d.id
  }

  async readSimilar(agentId: string, inputHash: string, limit = 5) {
    const qs = new URLSearchParams({
      agentId,
      hash: inputHash,
      limit: String(limit),
    })
    const r = await fetch(`${this.base}/episodes/similar?${qs}`, { headers: this.h() })
    if (!r.ok) {
      const err = (await r.json().catch(() => ({}))) as { error?: string }
      throw new Error(`[Platform API] episodes similar ${r.status}: ${err.error ?? r.statusText}`)
    }
    return r.json() as Promise<(EpisodeRecord & { id: number; outcomeLabel?: string })[]>
  }

  async linkOutcome(id: number, nodeId: number): Promise<void> {
    const r = await fetch(`${this.base}/episodes/${id}/outcome`, {
      method: 'PATCH',
      headers: this.h(),
      body: JSON.stringify({ outcomeNodeId: nodeId }),
    })
    if (!r.ok) {
      const err = (await r.json().catch(() => ({}))) as { error?: string }
      throw new Error(`[Platform API] episodes outcome ${r.status}: ${err.error ?? r.statusText}`)
    }
  }
}

function bodyForGraphWrite(op: GraphWriteOp, traceId: string): Record<string, unknown> {
  if (op.type === 'upsertNode') {
    return {
      kind: op.kind,
      label: op.label,
      description: op.description,
      metadata: op.metadata,
      traceId,
    }
  }
  return {
    fromId: op.fromId,
    toId: op.toId,
    kind: op.kind,
    weight: op.weight,
    metadata: op.metadata,
    traceId,
  }
}

// ── The HTTP adapter ───────────────────────────────────────────────────────
export class HttpRuntimeAdapter implements IRuntimeAdapter {
  readonly workingMemory: InMemoryWorkingMemory
  readonly episodicMemory: IEpisodicMemory
  private busHandlers = new Map<string, ((e: AgentContextEvent) => Promise<void>)[]>()
  private shutDown = false

  constructor(
    private readonly platformUrl: string,
    readonly agentId: string,
    readonly jwt: string,
    readonly runtime: RuntimeId,
    readonly domain: VerbDomain,
  ) {
    this.workingMemory = new InMemoryWorkingMemory()
    this.episodicMemory = new RemoteEpisodicMemory(platformUrl, jwt)
  }

  private h(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.jwt}`,
      'Content-Type': 'application/json',
    }
  }

  private assertActive(): void {
    if (this.shutDown) throw new Error(`[HttpRuntimeAdapter] ${this.agentId} is shut down`)
  }

  async graphWrite(op: GraphWriteOp): Promise<GraphWriteResult> {
    this.assertActive()
    const traceId = randomUUID()
    const url =
      op.type === 'upsertNode'
        ? `${this.platformUrl}/graph/nodes`
        : `${this.platformUrl}/graph/edges`
    const res = await fetch(url, {
      method: 'POST',
      headers: this.h(),
      body: JSON.stringify(bodyForGraphWrite(op, traceId)),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(`[Platform API] ${res.status}: ${err.error ?? res.statusText}`)
    }
    return res.json() as Promise<GraphWriteResult>
  }

  async graphRead<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.assertActive()
    const res = await fetch(`${this.platformUrl}/graph/query`, {
      method: 'POST',
      headers: this.h(),
      body: JSON.stringify({ sql, params }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(`[Platform API] graph query ${res.status}: ${err.error ?? res.statusText}`)
    }
    return res.json() as Promise<T[]>
  }

  async publish(event: Omit<AgentContextEvent, 'id' | 'agentId' | 'ts'>): Promise<void> {
    this.assertActive()
    // Non-blocking: agents must not fail a run if the bus is briefly unavailable
    await fetch(`${this.platformUrl}/events`, {
      method: 'POST',
      headers: this.h(),
      body: JSON.stringify({
        ...event,
        id: randomUUID(),
        agentId: this.agentId,
        ts: Date.now(),
      }),
    }).catch(() => {
      /* non-blocking */
    })
  }

  subscribe(pattern: string, handler: (e: AgentContextEvent) => Promise<void>): () => void {
    const list = this.busHandlers.get(pattern) ?? []
    list.push(handler)
    this.busHandlers.set(pattern, list)
    return () => {
      this.busHandlers.set(
        pattern,
        (this.busHandlers.get(pattern) ?? []).filter((h) => h !== handler),
      )
    }
  }

  /** Dispatch a locally subscribed event (used in tests / in-process fanout). */
  async dispatchLocal(pattern: string, event: AgentContextEvent): Promise<void> {
    for (const [p, handlers] of this.busHandlers) {
      if (p === pattern || matchNats(p, `context.${event.domain}.${event.kind}`)) {
        await Promise.all(handlers.map((h) => h(event)))
      }
    }
  }

  async health(): Promise<{ status: 'ok' | 'degraded'; detail?: string }> {
    if (this.shutDown) return { status: 'degraded', detail: 'shut down' }
    try {
      const res = await fetch(`${this.platformUrl}/health`)
      if (!res.ok) return { status: 'degraded', detail: `platform HTTP ${res.status}` }
      return { status: 'ok' }
    } catch (err) {
      return { status: 'degraded', detail: String(err) }
    }
  }

  async shutdown(): Promise<void> {
    this.shutDown = true
    this.busHandlers.clear()
    this.workingMemory.clear()
  }
}

function matchNats(pattern: string, subject: string): boolean {
  const re = new RegExp(
    '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[^.]+').replace(/>/g, '.*') + '$',
  )
  return re.test(subject)
}

// ── Factory: registers and gets a JWT ──────────────────────────────────────
export async function createHttpAdapter(
  platformUrl: string,
  manifest: AgentManifest,
): Promise<HttpRuntimeAdapter> {
  const base = platformUrl.replace(/\/$/, '')
  const res = await fetch(`${base}/agents/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manifest),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to register agent ${manifest.id}: ${res.status} ${body}`)
  }
  const { token } = (await res.json()) as { token: string }
  return new HttpRuntimeAdapter(base, manifest.id, token, manifest.runtime, manifest.domain)
}
