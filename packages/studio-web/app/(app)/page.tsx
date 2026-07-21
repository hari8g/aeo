import Link from 'next/link'
import { auth } from '@/auth'
import { platformFetch } from '@/lib/platform'
import { formatMoneyCompact, formatMoneyRange } from '@/lib/format'

type BusinessCaseRow = {
  feature_id: number
  title: string
  status: string
  status_key?: string
  value_low?: number | null
  value_high?: number | null
  value_period?: string | null
  value_currency?: string | null
  effort_low?: number | null
  effort_high?: number | null
  top_segment?: string | null
  sent_for_sizing?: boolean
  pain_point_count?: number
}

type GtmDetail = {
  feature_id: number
  title: string
  projection: {
    data?: {
      economics?: {
        blendedCacLow?: number
        blendedCacHigh?: number
        blendedLtvLow?: number
        blendedLtvHigh?: number
        paybackMonthsLow?: number
        paybackMonthsHigh?: number
        ltvCacRatio?: string
        deliveryCostLow?: number
        deliveryCostHigh?: number
        valueStartYear?: number
        currency?: string
        narrative?: string
      }
      positioning?: string
      segments?: Array<{ name: string; fit?: string }>
    }
  } | null
}

async function getCases() {
  try {
    return await platformFetch<BusinessCaseRow[]>('/studio/business-cases')
  } catch {
    return []
  }
}

async function getGtm(id: number) {
  try {
    return await platformFetch<GtmDetail>(`/studio/gtm/${id}`)
  } catch {
    return null
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

function programBlurb(title: string): { product: string; focus: string; unit: string } {
  if (/toll\.?os|mlff/i.test(title)) {
    return {
      product: 'Toll.OS',
      focus: 'Complete MLFF operating system — ANPR · FASTag RFID · LiDAR fusion, ₹5/event metering, ledger & reconciliation',
      unit: '₹5 / orchestration event',
    }
  }
  return {
    product: 'StaaS',
    focus: '3PL logistics integration (live inventory · ASN · dock planning) plus loyalty management (earn/burn · tiers · partners)',
    unit: 'EUR program value',
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
  const [cases, awaiting, closedLoops] = await Promise.all([
    getCases(),
    getAwaiting(userId),
    getClosedLoops(),
  ])
  const gtmRows = await Promise.all(cases.map((c) => getGtm(c.feature_id)))
  const gtmById = new Map(gtmRows.filter(Boolean).map((g) => [g!.feature_id, g!]))

  const demo = searchParams?.demo === '1'
  const showBanner = awaiting.isApprover && awaiting.count > 0
  const showClosedBanner = closedLoops.count > 0

  const admitted = cases.filter((c) => /admit/i.test(c.status) || c.status_key === 'admitted')
  const totalValueLow = cases.reduce((s, c) => s + (Number(c.value_low) || 0), 0)
  const totalValueHigh = cases.reduce((s, c) => s + (Number(c.value_high) || 0), 0)

  return (
    <>
      <div className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-bosch-muted mb-1">
          Bosch Mobility Platform &amp; Solutions
        </p>
        <h1 className="text-[22px] font-extrabold tracking-tight mb-1 text-ink-1">
          Good morning, {name}
        </h1>
        <p className="text-ink-3 text-[13.5px] max-w-2xl">
          Portfolio view of active MPS programs — value, delivery investment, go-to-market unit
          economics, and where each bet sits in the Listen → Decide → Define → Build → Ship → Learn
          loop.
        </p>
      </div>

      {demo && (
        <div className="mb-5 rounded-xl2 border border-pink-bd bg-pink-bg px-4 py-3 text-[13px] text-bosch-red font-semibold">
          Demo mode — signed in as Hariprasad (Admin). Navigate Decide through Learn on the two
          seeded programs.
        </div>
      )}

      {showBanner && (
        <Link href="/business-cases?filter=awaiting_decision" className="block mb-5">
          <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-4 flex items-center gap-3 hover:brightness-95">
            <div>
              <div className="font-bold text-[13.5px] text-ink-1">
                {awaiting.count} business case{awaiting.count > 1 ? 's' : ''} waiting on your
                decision
              </div>
              <div className="text-[12px] text-ink-2">Open Portfolio / Business Cases →</div>
            </div>
          </div>
        </Link>
      )}

      {showClosedBanner && (
        <Link href="/lessons" className="block mb-5">
          <div className="border border-ok-bd bg-ok-bg rounded-xl2 p-4 hover:brightness-95">
            <div className="font-bold text-[13.5px] text-ink-1">
              {closedLoops.count} cycle{closedLoops.count > 1 ? 's' : ''} closed — lessons ready for
              the next Listen pass
            </div>
            <div className="text-[12px] text-ink-2 mt-0.5">Review lessons learned →</div>
          </div>
        </Link>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <div className="rounded-xl3 border border-line bg-white px-4 py-4">
          <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">
            Active programs
          </div>
          <div className="text-2xl font-extrabold text-ink-1">{cases.length}</div>
          <div className="text-[12px] text-ink-2 mt-1">
            {admitted.length} admitted · full loop seeded
          </div>
        </div>
        <div className="rounded-xl3 border border-line bg-white px-4 py-4">
          <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">
            Portfolio value band
          </div>
          <div className="text-2xl font-extrabold text-ink-1 tracking-tight">
            {totalValueLow > 0
              ? `${formatMoneyCompact(totalValueLow, 'EUR')} – ${formatMoneyCompact(totalValueHigh, 'EUR')}`
              : '—'}
          </div>
          <div className="text-[12px] text-ink-2 mt-1">Annual run-rate across both programs</div>
        </div>
        <div className="rounded-xl3 border border-line bg-white px-4 py-4">
          <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">
            Organisation
          </div>
          <div className="text-[15px] font-extrabold text-ink-1 leading-snug">
            Bosch MPS · Toll.OS &amp; StaaS
          </div>
          <div className="text-[12px] text-ink-2 mt-1">
            CPO gate · product &amp; eng delivery · corridor / hub CS
          </div>
        </div>
      </div>

      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="text-[16px] font-extrabold text-ink-1">Programs in flight</h2>
        <Link href="/business-cases" className="text-xs font-bold text-bosch-red hover:underline">
          All business cases →
        </Link>
      </div>

      <div className="space-y-4 mb-8">
        {cases.length === 0 ? (
          <div className="rounded-xl3 border border-line bg-white px-5 py-10 text-center text-sm text-ink-3">
            No programs seeded yet. Run platform seed to load Toll.OS and StaaS demos.
          </div>
        ) : (
          cases.map((c) => {
            const blurb = programBlurb(c.title)
            const gtm = gtmById.get(c.feature_id)?.projection?.data
            const econ = gtm?.economics
            const currency = c.value_currency ?? econ?.currency ?? 'EUR'
            const valueStart = econ?.valueStartYear
            return (
              <article
                key={c.feature_id}
                className="rounded-xl3 border border-line bg-white overflow-hidden"
              >
                <div className="px-5 py-4 border-b border-line flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-bosch-muted mb-1">
                      {blurb.product}
                    </div>
                    <h3 className="text-[15px] font-extrabold text-ink-1 leading-snug">
                      {c.title}
                    </h3>
                    <p className="text-[12.5px] text-ink-2 mt-1.5 max-w-2xl leading-relaxed">
                      {blurb.focus}
                    </p>
                  </div>
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide rounded-full border border-line bg-surface-2 text-ink-2 px-2.5 py-1">
                    {c.status}
                  </span>
                </div>

                <div className="px-5 py-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">
                      Value
                    </div>
                    <div className="text-[14px] font-extrabold text-ink-1">
                      {c.value_low != null && c.value_high != null
                        ? formatMoneyRange(
                            Number(c.value_low),
                            Number(c.value_high),
                            currency,
                            c.value_period || 'year',
                            valueStart,
                          )
                        : '—'}
                    </div>
                    <div className="text-[11px] text-ink-3 mt-0.5">{blurb.unit}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">
                      Delivery
                    </div>
                    <div className="text-[14px] font-extrabold text-ink-1">
                      {econ?.deliveryCostLow != null && econ?.deliveryCostHigh != null
                        ? `${formatMoneyCompact(Number(econ.deliveryCostLow), currency)} – ${formatMoneyCompact(Number(econ.deliveryCostHigh), currency)}`
                        : c.effort_low != null && c.effort_high != null
                          ? `${c.effort_low}–${c.effort_high} weeks`
                          : '—'}
                    </div>
                    <div className="text-[11px] text-ink-3 mt-0.5">
                      {c.effort_low != null && c.effort_high != null
                        ? `${c.effort_low}–${c.effort_high} weeks engineering`
                        : 'Fully loaded delivery'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">
                      CAC · LTV
                    </div>
                    <div className="text-[14px] font-extrabold text-ink-1">
                      {econ?.blendedCacLow != null
                        ? `${formatMoneyCompact(Number(econ.blendedCacLow), currency)}–${formatMoneyCompact(Number(econ.blendedCacHigh), currency)}`
                        : '—'}
                    </div>
                    <div className="text-[11px] text-ink-3 mt-0.5">
                      LTV{' '}
                      {econ?.blendedLtvLow != null
                        ? `${formatMoneyCompact(Number(econ.blendedLtvLow), currency)}–${formatMoneyCompact(Number(econ.blendedLtvHigh), currency)}`
                        : '—'}
                      {econ?.ltvCacRatio ? ` · ${econ.ltvCacRatio}` : ''}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">
                      Payback
                    </div>
                    <div className="text-[14px] font-extrabold text-ink-1">
                      {econ?.paybackMonthsLow != null
                        ? `${econ.paybackMonthsLow}–${econ.paybackMonthsHigh} mo`
                        : '—'}
                    </div>
                    <div className="text-[11px] text-ink-3 mt-0.5">
                      {c.top_segment || gtm?.segments?.[0]?.name || 'Primary segment'}
                    </div>
                  </div>
                </div>

                {(gtm?.positioning || econ?.narrative) && (
                  <div className="px-5 pb-3">
                    <p className="text-[12.5px] text-ink-2 leading-relaxed">
                      {econ?.narrative || gtm?.positioning}
                    </p>
                  </div>
                )}

                <div className="px-5 py-3 border-t border-line bg-surface-2 flex flex-wrap gap-x-4 gap-y-2 text-[12px] font-semibold">
                  <Link
                    href={`/business-cases/${c.feature_id}`}
                    className="text-bosch-red hover:underline"
                  >
                    Case
                  </Link>
                  <Link
                    href={`/business-cases/${c.feature_id}/value`}
                    className="text-ink-2 hover:text-bosch-red hover:underline"
                  >
                    Value
                  </Link>
                  <Link
                    href={`/gtm/${c.feature_id}`}
                    className="text-ink-2 hover:text-bosch-red hover:underline"
                  >
                    GTM
                  </Link>
                  <Link
                    href={`/requirements/${c.feature_id}`}
                    className="text-ink-2 hover:text-bosch-red hover:underline"
                  >
                    Requirements
                  </Link>
                  <Link
                    href={`/architecture/${c.feature_id}`}
                    className="text-ink-2 hover:text-bosch-red hover:underline"
                  >
                    Architecture
                  </Link>
                  <Link
                    href={`/build/${c.feature_id}`}
                    className="text-ink-2 hover:text-bosch-red hover:underline"
                  >
                    Build
                  </Link>
                  <Link
                    href={`/docs/${c.feature_id}`}
                    className="text-ink-2 hover:text-bosch-red hover:underline"
                  >
                    Docs
                  </Link>
                  <Link
                    href="/lessons"
                    className="text-ink-2 hover:text-bosch-red hover:underline"
                  >
                    Lessons
                  </Link>
                </div>
              </article>
            )
          })
        )}
      </div>

      <div className="rounded-xl3 border border-line bg-white px-5 py-4">
        <div className="text-sm font-extrabold text-ink-1 mb-1">How the value stream runs</div>
        <p className="text-[12.5px] text-ink-2 leading-relaxed mb-3">
          <span className="font-semibold text-ink-1">Listen</span> captures corridor and hub
          signals → <span className="font-semibold text-ink-1">Decide</span> sizes value, effort,
          and GTM → <span className="font-semibold text-ink-1">Define</span> baselines
          requirements, domain, and architecture →{' '}
          <span className="font-semibold text-ink-1">Build</span> records implementation, quality,
          and docs → <span className="font-semibold text-ink-1">Ship</span> clears release and
          rollout → <span className="font-semibold text-ink-1">Learn</span> closes the loop with
          outcomes and calibration for the next bet.
        </p>
        <p className="text-[12px] text-ink-3">
          Bosch Mobility Platform &amp; Solutions —{' '}
          <a
            href="https://www.bosch-mps.com/en/home"
            className="text-bosch-red font-semibold underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            bosch-mps.com
          </a>
        </p>
      </div>
    </>
  )
}
