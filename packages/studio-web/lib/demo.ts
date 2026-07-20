/** Localhost demo bypass — enabled unless explicitly disabled. */
export function isDemoBypassEnabled(): boolean {
  if (process.env.DEMO_BYPASS === '0' || process.env.DEMO_BYPASS === 'false') return false
  if (process.env.DEMO_BYPASS === '1' || process.env.DEMO_BYPASS === 'true') return true
  return process.env.NODE_ENV !== 'production'
}
