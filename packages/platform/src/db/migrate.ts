import 'dotenv/config'
import { initPool, migrate, closePool } from './pool.js'

async function main(): Promise<void> {
  await initPool()
  await migrate()
  await closePool()
  console.log('[migrate] done')
}

main().catch((err) => {
  console.error('[migrate] failed:', err)
  process.exit(1)
})
