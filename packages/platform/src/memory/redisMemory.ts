import { Redis } from 'ioredis'
import type { IWorkingMemory } from '@avp/shared'

let client: Redis | null = null

export function getRedis(): Redis {
  if (!client) throw new Error('Redis not initialized')
  return client
}

export async function initRedis(): Promise<Redis> {
  client = new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  })
  await client.connect()
  await client.ping()
  console.log('[Redis] connected')
  return client
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit()
    client = null
  }
}

export class RedisWorkingMemory implements IWorkingMemory {
  constructor(
    private readonly redis: Redis,
    private readonly agentId: string,
  ) {}

  private key(k: string): string {
    return `wm:${this.agentId}:${k}`
  }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.redis.get(this.key(key))
    return raw ? (JSON.parse(raw) as T) : undefined
  }

  async set<T>(key: string, value: T, ttlSeconds = 3600): Promise<void> {
    await this.redis.setex(this.key(key), ttlSeconds, JSON.stringify(value))
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(this.key(key))
  }
}
