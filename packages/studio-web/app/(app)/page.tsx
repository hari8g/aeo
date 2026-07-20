import Link from 'next/link'
import StatCard from '@/components/StatCard'
import { auth } from '@/auth'
import { platformFetch } from '@/lib/platform'

async function getStats() {
  try {
    return await platformFetch<{
      newProblems: number
      totalFeedback: number
      topAffected: number
    }>('/studio/stats')
  } catch {
    return { newProblems: 0, totalFeedback: 0, topAffected: 0 }
  }
}

async function getAwaiting(userId?: string) {
  if (!userId) return { isApprover: false, count: 0 }
  try {
    return await platformFetch<{ isApprover: boolean; count: number }>(
      `/studio/portfolio/awaiting?userId=${encodeURIComponent(userId)}`,
    )
  } catch {
    return { isApprover: false, count: 0 }
  }
}

async function getClosedLoops() {
  try {
    return await platformFetch<{ count: number }>('/studio/loop/closed')
  } catch {
    return { count: 0 }
  }
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: { demo?: string }
}) {
  const session = await auth()
  const userId = (session?.user as { id?: string } | undefined)?.id
  const name = session?.user?.name?.split(' ')[0] || 'there'
  const [stats, awaiting, closedLoops] = await Promise.all([
    getStats(),
    getAwaiting(userId),
    getClosedLoops(),
  ])
  const demo = searchParams?.demo === '1'
  const showBanner = awaiting.isApprover && awaiting.count > 0
  const showClosedBanner = closedLoops.count > 0

  return (
    <>
      <div className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-bosch-muted mb-1">
          Bosch Mobility Platform &amp; Solutions
        </p>
        <h1 className="text-[22px] font-extrabold tracking-tight mb-1 text-ink-1">
          Good morning, {name}
        </h1>
        <p className="text-ink-3 text-[13.5px]">
          Here&apos;s what customers have been telling you this week across Toll.OS MLFF
          orchestration and StaaS 3PL logistics.
        </p>
      </div>
      {demo && (
        <div className="mb-5 rounded-xl2 border border-pink-bd bg-pink-bg px-4 py-3 text-[13px] text-bosch-red font-semibold">
          Demo mode — signed in as Hariprasad (Admin). Try Add Feedback, Pain Points, Settings, and
          Team &amp; Access.
        </div>
      )}
      {showBanner && (
        <Link href="/business-cases?filter=awaiting_decision" className="block mb-6">
          <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-4 flex items-center gap-3 hover:brightness-95">
            <span className="text-2xl" aria-hidden>
              ⏳
            </span>
            <div>
              <div className="font-bold text-[13.5px] text-ink-1">
                {awaiting.count} business case{awaiting.count > 1 ? 's' : ''} waiting on your
                decision
              </div>
              <div className="text-[12px] text-ink-2">Head to Business Cases to review →</div>
            </div>
          </div>
        </Link>
      )}
      {showClosedBanner && (
        <Link href="/lessons" className="block mb-6">
          <div className="border border-ok-bd bg-ok-bg rounded-xl2 p-4 flex items-center gap-3 hover:brightness-95">
            <div>
              <div className="font-bold text-[13.5px] text-ink-1">
                {closedLoops.count} cycle{closedLoops.count > 1 ? 's' : ''} closed — lessons ready
                for the next Listen pass
              </div>
              <div className="text-[12px] text-ink-2">Review lessons →</div>
            </div>
          </div>
        </Link>
      )}
      <div className="grid grid-cols-3 gap-3.5 mb-8">
        <StatCard num={stats.newProblems} label="New problems found this week" accent />
        <StatCard num={stats.totalFeedback} label="Pieces of feedback added" />
        <StatCard num={stats.topAffected} label="Customers affected by the top issue" />
      </div>
      <div className="rounded-xl3 border border-line bg-white px-5 py-4">
        <div className="text-sm font-extrabold text-ink-1 mb-1">Connected. Digital. Sustainable.</div>
        <p className="text-[12.5px] text-ink-2 leading-relaxed">
          Insights for Toll.OS (MLFF ANPR · RFID · LiDAR) and StaaS 3PL logistics — inspired by{' '}
          <a
            href="https://www.bosch-mps.com/en/home"
            className="text-bosch-red font-semibold underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Bosch MPS
          </a>
          .
        </p>
      </div>
    </>
  )
}
