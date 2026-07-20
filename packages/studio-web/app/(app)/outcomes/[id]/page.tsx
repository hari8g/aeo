import { auth } from '@/auth'
import { canEditBusinessCase } from '@/lib/roles'
import { platformFetch } from '@/lib/platform'
import OutcomesClient from './OutcomesClient'

export default async function OutcomesDetailPage({ params }: { params: { id: string } }) {
  const session = await auth()
  const role = (session?.user as { role?: string } | undefined)?.role
  let title = 'Outcomes'
  try {
    const detail = await platformFetch<{ title: string }>(`/studio/outcomes/${params.id}`)
    title = detail.title || title
  } catch {
    /* client loads */
  }

  return (
    <>
      <div className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-bosch-muted mb-1">
          Learn · Outcomes
        </p>
        <h1 className="text-[22px] font-extrabold tracking-tight mb-1">{title}</h1>
        <p className="text-ink-3 text-[13.5px]">
          Verdict against the hypothesis — what the live metrics say we achieved.
        </p>
      </div>
      <OutcomesClient id={params.id} canEdit={canEditBusinessCase(role)} />
    </>
  )
}
