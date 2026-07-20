/** Bosch-aligned segment colors — avoid purple SaaS defaults */
const COLORS: Record<string, string> = {
  design: '#5C6670',
  implementation: '#0369A1',
  testing: '#0D9268',
  integration: '#D97706',
  documentation: '#98A2B3',
}

const LABELS: Record<string, string> = {
  design: 'Design',
  implementation: 'Building it',
  testing: 'Testing',
  integration: 'Connecting the pieces',
  documentation: 'Writing it up',
}

const ORDER = ['design', 'implementation', 'testing', 'integration', 'documentation'] as const

export default function EffortBreakdown({
  breakdown,
}: {
  breakdown: Record<string, number> | null | undefined
}) {
  const entries = ORDER.map((k) => [k, Number(breakdown?.[k] ?? 0)] as const).filter(
    ([, v]) => v > 0,
  )
  const total = entries.reduce((a, [, b]) => a + b, 0) || 1

  if (!entries.length) {
    return <p className="text-[12.5px] text-ink-3">No breakdown available yet.</p>
  }

  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden mb-3 bg-surface-2">
        {entries.map(([k, v]) => (
          <div
            key={k}
            style={{ width: `${(v / total) * 100}%`, background: COLORS[k] ?? '#98A2B3' }}
            title={LABELS[k] ?? k}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 text-[11.5px] text-ink-2">
            <span
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ background: COLORS[k] ?? '#98A2B3' }}
            />
            <span>{LABELS[k] ?? k}</span>
            <span className="ml-auto font-mono text-[10.5px] text-ink-3">
              {Math.round((v / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
