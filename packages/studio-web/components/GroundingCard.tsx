export default function GroundingCard({
  icon,
  title,
  body,
}: {
  icon: string
  title: string
  body: string
}) {
  return (
    <div className="border border-line rounded-xl2 px-4 py-3 bg-surface-2">
      <div className="text-lg mb-1">{icon}</div>
      <div className="text-[13px] font-bold text-ink-1 mb-0.5">{title}</div>
      <p className="text-[12px] text-ink-3 leading-relaxed">{body}</p>
    </div>
  )
}
