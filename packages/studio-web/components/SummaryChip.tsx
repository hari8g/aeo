export default function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line rounded-xl2 px-3 py-2.5 bg-white">
      <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-0.5">{label}</div>
      <div className="text-[12.5px] font-semibold text-ink-1">{value}</div>
    </div>
  )
}
