'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Home,
  Inbox,
  Lightbulb,
  Settings,
  Users,
  FileText,
  Map,
  Scale,
  ScrollText,
  ListChecks,
  BookOpen,
  Network,
  Hammer,
  ShieldCheck,
  FilePenLine,
  Rocket,
  ShieldAlert,
  BadgeCheck,
  Activity,
  Target,
  HeartHandshake,
  GraduationCap,
} from 'lucide-react'
import BoschLogo from '@/components/BoschLogo'

type NavItem = {
  href: string
  label: string
  icon: typeof Home
  adminOnly?: boolean
}

const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [{ href: '/', label: 'Home', icon: Home }],
  },
  {
    label: 'Listen',
    items: [
      { href: '/feedback', label: 'Add Feedback', icon: Inbox },
      { href: '/pain-points', label: 'Pain Points', icon: Lightbulb },
    ],
  },
  {
    label: 'Decide',
    items: [
      { href: '/business-cases', label: 'Business Cases', icon: FileText },
      { href: '/gtm', label: 'Go-to-Market', icon: Map },
      { href: '/portfolio', label: 'Portfolio Review', icon: Scale },
      { href: '/decisions', label: 'Decision History', icon: ScrollText },
    ],
  },
  {
    label: 'Define',
    items: [
      { href: '/requirements', label: 'Requirements', icon: ListChecks },
      { href: '/domain', label: 'Domain Model', icon: BookOpen },
      { href: '/architecture', label: 'Architecture', icon: Network },
    ],
  },
  {
    label: 'Build',
    items: [
      { href: '/build', label: 'Implementation', icon: Hammer },
      { href: '/quality', label: 'Quality', icon: ShieldCheck },
      { href: '/docs', label: 'Docs', icon: FilePenLine },
    ],
  },
  {
    label: 'Ship',
    items: [
      { href: '/builds', label: 'Builds', icon: Rocket },
      { href: '/safety', label: 'Safety', icon: ShieldAlert },
      { href: '/release', label: 'Release', icon: BadgeCheck },
      { href: '/rollout', label: 'Rollout', icon: Activity },
    ],
  },
  {
    label: 'Learn',
    items: [
      { href: '/outcomes', label: 'Outcomes', icon: Target },
      { href: '/impact', label: 'Impact', icon: HeartHandshake },
      { href: '/lessons', label: 'Lessons', icon: GraduationCap },
    ],
  },
  {
    label: null,
    items: [
      { href: '/settings', label: 'Settings', icon: Settings, adminOnly: true },
      { href: '/access', label: 'Team & Access', icon: Users, adminOnly: true },
    ],
  },
]

type StudioUser = { name?: string | null; role?: string }

export default function Sidebar({ user }: { user: StudioUser }) {
  const pathname = usePathname()
  const isAdmin = user.role === 'admin'
  const initials =
    user.name
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'

  return (
    <aside className="bg-white border-r border-line px-4 py-6 sticky top-0 h-screen flex flex-col">
      <div className="px-2 pb-5 border-b border-line mb-4">
        <BoschLogo variant="mark" className="h-8 w-auto mb-2" />
        <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-bosch-muted">
          Mobility Platform &amp; Solutions
        </div>
        <div className="text-[14px] font-extrabold text-ink-1 tracking-tight mt-0.5">
          Customer Insights
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto">
        {NAV_GROUPS.map((group, gi) => {
          const items = group.items.filter((item) => !item.adminOnly || isAdmin)
          if (!items.length) return null
          return (
            <div key={group.label ?? `g-${gi}`}>
              {group.label && (
                <div className="text-[9px] font-bold uppercase tracking-wider text-ink-3 px-3 pt-3 pb-1.5">
                  {group.label}
                </div>
              )}
              {items.map((item) => {
                const active =
                  item.href === '/'
                    ? pathname === '/'
                    : pathname === item.href || pathname.startsWith(`${item.href}/`)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl2 text-sm font-semibold mb-0.5 ${
                      active
                        ? 'bg-pink-bg text-pink border border-pink-bd'
                        : 'text-ink-2 hover:bg-surface-2 border border-transparent'
                    }`}
                  >
                    <item.icon size={18} />
                    {item.label}
                  </Link>
                )
              })}
            </div>
          )
        })}
      </nav>

      <div className="flex items-center gap-2.5 p-2.5 rounded-xl2 bg-surface-2 border border-line">
        <div className="w-8 h-8 rounded-full bg-bosch-red text-white text-xs font-bold flex items-center justify-center">
          {initials}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-bold truncate">{user.name}</div>
          <div className="text-[10px] text-ink-3 capitalize">{user.role}</div>
        </div>
      </div>
    </aside>
  )
}
