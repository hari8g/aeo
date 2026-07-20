import pg from 'pg'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

let pool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (!pool) throw new Error('DB pool not initialized — call initPool() first')
  return pool
}

export async function initPool(): Promise<pg.Pool> {
  pool = new pg.Pool({
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5433', 10),
    database: process.env.DB_NAME ?? 'avp',
    user: process.env.DB_USER ?? 'avp',
    password: process.env.DB_PASSWORD ?? 'avp_dev_password',
    max: 20,
    idleTimeoutMillis: 30_000,
  })
  await pool.query('SELECT 1')
  return pool
}

export async function migrate(): Promise<void> {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
  await getPool().query(sql)
  console.log('[DB] schema applied')
}

export async function query<T>(sql: string, params?: unknown[]): Promise<T[]> {
  const res = await getPool().query(sql, params)
  return res.rows as T[]
}

export async function queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(sql, params)
  return rows[0] ?? null
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
