import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const bundle = join(root, '../../studio-web/public/office/main.js')
const fallback = join(root, '../src/roster.fallback.json')

if (!existsSync(bundle)) {
  console.error('[office-view] missing bundle — run pnpm -F @avp/office-view build')
  process.exit(1)
}
const bytes = statSync(bundle).size
if (bytes < 50_000) {
  console.error(`[office-view] bundle too small (${bytes} bytes)`)
  process.exit(1)
}
const roster = JSON.parse(readFileSync(fallback, 'utf8'))
if ((roster.agents ?? []).length !== 23) {
  console.error(`[office-view] fallback roster should have 23 agents, got ${roster.agents?.length}`)
  process.exit(1)
}
const src = readFileSync(bundle, 'utf8')
for (const token of [
  'office-root',
  'MPS/COR',
  'Knowledge graph',
  'MPS/ENI',
  'MPS/PAS',
  'ServiceNow',
  'Salesforce',
  'Adapters',
]) {
  if (!src.includes(token)) {
    console.error(`[office-view] bundle missing expected token: ${token}`)
    process.exit(1)
  }
}
console.log(`[office-view] check ok · ${bytes} bytes · 23 runtime agents`)
