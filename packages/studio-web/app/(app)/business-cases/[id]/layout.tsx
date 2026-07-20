import { platformFetch } from '@/lib/platform'
import CaseTabStrip from '@/components/CaseTabStrip'

type CaseDetail = {
  title: string
  sent_for_sizing?: boolean
  status?: string
}

export default async function BusinessCaseLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { id: string }
}) {
  let title = 'Business case'
  let sent = false
  try {
    const detail = await platformFetch<CaseDetail>(`/studio/business-cases/${params.id}`)
    title = detail.title || title
    sent =
      !!detail.sent_for_sizing ||
      [
        'Sizing in progress',
        'Awaiting decision',
        '✓ Admitted',
        '↩ Deferred',
        '✗ Rejected',
        'Sent for sizing',
      ].includes(detail.status ?? '')
  } catch {
    /* page will show its own error */
  }

  return (
    <>
      <div className="mb-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-bosch-muted mb-1">
          Decide · Business case
        </p>
        <h1 className="text-[22px] font-extrabold tracking-tight mb-1">{title}</h1>
        <p className="text-ink-3 text-[13.5px]">
          {sent
            ? 'Sizing is underway — review the case, value, and effort side by side.'
            : 'Review the draft, adjust the wording, then send it for value and effort sizing.'}
        </p>
      </div>
      {sent && <CaseTabStrip featureId={params.id} />}
      {children}
    </>
  )
}
