import { Redis } from 'ioredis'
import type { IWorkingMemory } from '@avp/shared'

let client: Redis | null = null
let memoryFallback = false

type MemEntry = { value: string; expiresAt: number | null }
const memoryStore = new Map<string, MemEntry>()

export function isRedisUsingMemoryFallback(): boolean {
  return memoryFallback
}

export function getRedis(): Redis {
  if (!client) throw new Error('Redis not initialized')
  return client
}

/** Prefer real Redis; if unreachable, use in-process memory so Studio can run without Docker. */
export async function initRedis(): Promise<Redis | null> {
  const host = process.env.REDIS_HOST ?? 'localhost'
  const port = parseInt(process.env.REDIS_PORT ?? '6379', 10)

  if (process.env.REDIS_OPTIONAL === '0') {
    client = new Redis({ host, port, maxRetriesPerRequest: 3, lazyConnect: true })
    await client.connect()
    await client.ping()
    memoryFallback = false
    console.log('[Redis] connected')
    return client
  }

  try {
    const probe = new Redis({
      host,
      port,
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
      lazyConnect: true,
      retryStrategy: () => null,
    })
    await probe.connect()
    await probe.ping()
    client = probe
    memoryFallback = false
    console.log('[Redis] connected')
    return client
  } catch (err) {
    memoryFallback = true
    client = null
    console.warn(
      '[Redis] unavailable — using in-memory working memory (fine for local Studio demo):',
      String(err),
    )
    return null
  }
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit()
    client = null
  }
  memoryStore.clear()
  memoryFallback = false
}

function memGet(key: string): string | null {
  const e = memoryStore.get(key)
  if (!e) return null
  if (e.expiresAt != null && Date.now() > e.expiresAt) {
    memoryStore.delete(key)
    return null
  }
  return e.value
}

function memSet(key: string, value: string, ttlSeconds?: number): void {
  memoryStore.set(key, {
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
  })
}

export class RedisWorkingMemory implements IWorkingMemory {
  constructor(
    private readonly redis: Redis | null,
    private readonly agentId: string,
  ) {}

  private key(k: string): string {
    return `wm:${this.agentId}:${k}`
  }

  async get<T>(key: string): Promise<T | undefined> {
    const k = this.key(key)
    const raw = this.redis ? await this.redis.get(k) : memGet(k)
    return raw ? (JSON.parse(raw) as T) : undefined
  }

  async set<T>(key: string, value: T, ttlSeconds = 3600): Promise<void> {
    const k = this.key(key)
    const payload = JSON.stringify(value)
    if (this.redis) {
      await this.redis.setex(k, ttlSeconds, payload)
    } else {
      memSet(k, payload, ttlSeconds)
    }
  }

  async delete(key: string): Promise<void> {
    const k = this.key(key)
    if (this.redis) {
      await this.redis.del(k)
    } else {
      memoryStore.delete(k)
    }
  }
}
