'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

function Tab({
  href,
  label,
  active,
}: {
  href: string
  label: string
  active: boolean
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-2.5 text-[12px] font-bold border-b-2 -mb-px transition-colors ${
        active
          ? 'border-bosch-red text-bosch-red'
          : 'border-transparent text-ink-3 hover:text-ink-2'
      }`}
    >
      {label}
    </Link>
  )
}

export default function CaseTabStrip({ featureId }: { featureId: string }) {
  const pathname = usePathname()
  const base = `/business-cases/${featureId}`
  const activeTab =
    pathname.endsWith('/value') ? 'value' : pathname.endsWith('/effort') ? 'effort' : 'case'

  return (
    <div className="flex gap-1 border-b border-line mb-5 mt-2">
      <Tab href={base} label="The Case" active={activeTab === 'case'} />
      <Tab href={`${base}/value`} label="Business Value" active={activeTab === 'value'} />
      <Tab href={`${base}/effort`} label="Engineering Effort" active={activeTab === 'effort'} />
    </div>
  )
}
