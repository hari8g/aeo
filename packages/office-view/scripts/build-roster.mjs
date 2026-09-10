import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const out = join(root, '../src/roster.generated.json')
const fallback = join(root, '../src/roster.fallback.json')
const platform = process.env.PLATFORM_URL ?? 'http://localhost:7070'
const secret = process.env.STUDIO_SECRET ?? 'avp-studio-dev-secret'

mkdirSync(dirname(out), { recursive: true })

try {
  const res = await fetch(`${platform}/studio/office/roster`, {
    headers: { 'X-Studio-Secret': secret },
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const data = await res.json()
  if (!Array.isArray(data.agents) || data.agents.length === 0) {
    throw new Error('empty roster')
  }
  writeFileSync(out, JSON.stringify(data, null, 2) + '\n')
  console.log(`[office-view] roster.generated.json written (${data.agents.length} agents)`)
} catch (err) {
  const { readFileSync, copyFileSync } = await import('node:fs')
  try {
    copyFileSync(fallback, out)
    console.warn(
      `[office-view] Platform not reachable at ${platform} (${String(err)}). Using roster.fallback.json.`,
    )
    const snap = JSON.parse(readFileSync(fallback, 'utf8'))
    console.warn(`[office-view] fallback snapshot has ${snap.agents?.length ?? 0} agents`)
  } catch (copyErr) {
    console.error('[office-view] could not write roster', copyErr)
    process.exit(1)
  }
}
