export default function OfficeLayout({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 z-30 bg-[#FDFFF8] overflow-hidden">{children}</div>
}
