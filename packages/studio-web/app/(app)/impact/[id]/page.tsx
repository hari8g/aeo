import { auth } from '@/auth'
import { canEditBusinessCase } from '@/lib/roles'
import { platformFetch } from '@/lib/platform'
import ImpactClient from './ImpactClient'

export default async function ImpactDetailPage({ params }: { params: { id: string } }) {
  const session = await auth()
  const role = (session?.user as { role?: string } | undefined)?.role
  let title = 'Impact'
  try {
    const detail = await platformFetch<{ title: string }>(`/studio/impact/${params.id}`)
    title = detail.title || title
  } catch {
    /* client loads */
  }

  return (
    <>
      <div className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-bosch-muted mb-1">
          Learn · Impact
        </p>
        <h1 className="text-[22px] font-extrabold tracking-tight mb-1">{title}</h1>
        <p className="text-ink-3 text-[13.5px]">
          Stakeholder sentiment after the change landed in production.
        </p>
      </div>
      <ImpactClient id={params.id} canEdit={canEditBusinessCase(role)} />
    </>
  )
}
