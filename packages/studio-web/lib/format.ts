export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(Math.round(n))
}

/** Compact money for board rows — INR for Toll.OS event metering demos. */
export function formatMoneyCompact(n: number, currency = 'INR'): string {
  const symbol =
    currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'INR' ? '₹' : `${currency} `
  return `${symbol}${formatCompact(n)}`
}

export function formatMoneyRange(
  low: number,
  high: number,
  currency = 'INR',
  period = 'year',
  startYear?: number | null,
): string {
  const start =
    startYear && Number.isFinite(startYear) ? ` starting from ${Math.round(startYear)}` : ''

  // Large amounts read better compact (€350K / €1.5M) than full locale digits
  if (Math.max(Math.abs(low), Math.abs(high)) >= 100_000) {
    return `${formatMoneyCompact(low, currency)} – ${formatMoneyCompact(high, currency)} / ${period}${start}`
  }

  try {
    const locale = currency === 'INR' ? 'en-IN' : currency === 'EUR' ? 'en-IE' : 'en-US'
    const fmt = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    })
    return `${fmt.format(low)} – ${fmt.format(high)} / ${period}${start}`
  } catch {
    return `${formatMoneyCompact(low, currency)}–${formatMoneyCompact(high, currency)} / ${period}${start}`
  }
}
