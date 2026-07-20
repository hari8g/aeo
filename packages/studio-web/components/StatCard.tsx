export default function StatCard({
  num,
  label,
  accent,
}: {
  num: number | string
  label: string
  accent?: boolean
}) {
  return (
    <div
      className={`rounded-xl3 border px-5 py-4 ${
        accent ? 'bg-pink-bg border-pink-bd' : 'bg-white border-line'
      }`}
    >
      <div className={`text-[28px] font-extrabold tracking-tight ${accent ? 'text-pink' : 'text-ink-1'}`}>
        {num ?? 0}
      </div>
      <div className="text-[12.5px] text-ink-3 mt-1 font-medium leading-snug">{label}</div>
    </div>
  )
}
