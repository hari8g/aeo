import {
  connect,
  StringCodec,
  RetentionPolicy,
  StorageType,
  type NatsConnection,
  type JetStreamClient,
} from 'nats'
import type { AgentContextEvent } from '@avp/shared'

const sc = StringCodec()

export class ContextBus {
  private nc: NatsConnection | null = null
  private js: JetStreamClient | null = null
  private handlers = new Map<string, ((e: AgentContextEvent) => Promise<void>)[]>()
  private connected = false

  isConnected(): boolean {
    return this.connected
  }

  async connect(natsUrl = process.env.NATS_URL ?? 'nats://localhost:4222'): Promise<void> {
    try {
      this.nc = await connect({ servers: natsUrl, reconnect: true, maxReconnectAttempts: -1 })
      this.js = this.nc.jetstream()
      const jsm = await this.nc.jetstreamManager()
      try {
        await jsm.streams.add({
          name: 'CONTEXT',
          subjects: ['context.>'],
          storage: StorageType.File,
          retention: RetentionPolicy.Limits,
          max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in ns
          num_replicas: 1,
        })
      } catch (e) {
        const msg = String(e)
        if (!msg.includes('stream name already in use') && !msg.includes('subjects overlap')) {
          throw e
        }
      }
      this.connected = true
      console.log('[ContextBus] connected to', natsUrl)
    } catch (err) {
      console.warn('[ContextBus] NATS unavailable — in-process fallback active:', String(err))
      this.nc = null
      this.js = null
      this.connected = false
    }
  }

  async publish(event: AgentContextEvent): Promise<void> {
    const subject = `context.${event.domain}.${event.kind}`
    const data = sc.encode(JSON.stringify(event))
    if (this.js) {
      await this.js.publish(subject, data)
    } else {
      this.dispatchLocal(subject, event)
    }
  }

  subscribe(
    pattern: string,
    _durableName: string,
    handler: (e: AgentContextEvent) => Promise<void>,
  ): () => void {
    const list = this.handlers.get(pattern) ?? []
    list.push(handler)
    this.handlers.set(pattern, list)

    if (this.nc) {
      // NATS core wildcards: * = one token, > = one or more — keep as-is for subscribe
      const sub = this.nc.subscribe(pattern)
      ;(async () => {
        for await (const msg of sub) {
          try {
            const e = JSON.parse(sc.decode(msg.data)) as AgentContextEvent
            await handler(e)
          } catch (err) {
            console.error('[ContextBus] handler error:', err)
          }
        }
      })()
      return () => {
        sub.unsubscribe()
        this.handlers.set(
          pattern,
          (this.handlers.get(pattern) ?? []).filter((h) => h !== handler),
        )
      }
    }

    return () => {
      this.handlers.set(
        pattern,
        (this.handlers.get(pattern) ?? []).filter((h) => h !== handler),
      )
    }
  }

  private dispatchLocal(subject: string, event: AgentContextEvent): void {
    for (const [pattern, handlers] of this.handlers) {
      if (this.match(pattern, subject)) {
        handlers.forEach((h) => h(event).catch(console.error))
      }
    }
  }

  private match(pattern: string, subject: string): boolean {
    const re = new RegExp(
      '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[^.]+').replace(/>/g, '.*') + '$',
    )
    return re.test(subject)
  }

  async drain(): Promise<void> {
    await this.nc?.drain()
    this.connected = false
  }
}
