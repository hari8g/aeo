export default function ScoreGauge({
  label,
  score,
  inverted = false,
}: {
  label: string
  score: number
  inverted?: boolean
}) {
  const clamped = Math.min(100, Math.max(0, score))
  const good = inverted ? clamped < 40 : clamped >= 60
  const mid = inverted ? clamped < 70 : clamped >= 40
  const colorClass = good ? 'text-ok' : mid ? 'text-amber' : 'text-pink'
  const barClass = good ? 'bg-ok' : mid ? 'bg-amber' : 'bg-pink'

  return (
    <div className="border border-line rounded-xl2 p-4 text-center bg-white">
      <div className="text-[11px] font-bold uppercase tracking-wide text-ink-3 mb-1">{label}</div>
      <div className={`text-2xl font-extrabold ${colorClass}`}>
        {clamped}
        <span className="text-sm text-ink-3 font-semibold">/100</span>
      </div>
      <div className="w-full h-1.5 bg-surface-2 rounded-full mt-2 overflow-hidden">
        <div className={`h-full ${barClass}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}
