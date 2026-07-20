type Tier = 'ok' | 'amber' | 'pink'

const TIER: Record<Tier, { border: string; selected: string; title: string }> = {
  ok: {
    border: 'border-ok-bd',
    selected: 'bg-ok-bg border-ok',
    title: 'text-ok',
  },
  amber: {
    border: 'border-amber-bd',
    selected: 'bg-amber-bg border-amber',
    title: 'text-amber',
  },
  pink: {
    border: 'border-pink-bd',
    selected: 'bg-pink-bg border-pink',
    title: 'text-pink',
  },
}

export default function DecisionOption({
  value,
  selected,
  onSelect,
  title,
  tier,
  body,
}: {
  value: string
  selected: boolean
  onSelect: (v: string) => void
  title: string
  tier: Tier
  body: string
}) {
  const styles = TIER[tier]
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={`text-left border rounded-xl2 px-3 py-3 transition-colors ${
        selected ? styles.selected : `${styles.border} bg-white hover:bg-surface-1`
      }`}
    >
      <div className={`text-[13px] font-extrabold mb-1 ${styles.title}`}>{title}</div>
      <p className="text-[11.5px] text-ink-3 leading-relaxed">{body}</p>
    </button>
  )
}
