import { auth } from '@/auth'
import { canEditBusinessCase } from '@/lib/roles'
import { platformFetch } from '@/lib/platform'
import QualityClient from './QualityClient'

export default async function QualityDetailPage({ params }: { params: { id: string } }) {
  const session = await auth()
  const role = (session?.user as { role?: string } | undefined)?.role
  let title = 'Quality'
  try {
    const detail = await platformFetch<{ title: string }>(`/studio/quality/${params.id}`)
    title = detail.title || title
  } catch {
    /* client loads */
  }

  return (
    <>
      <div className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-bosch-muted mb-1">
          Build · Quality
        </p>
        <h1 className="text-[22px] font-extrabold tracking-tight mb-1">{title}</h1>
        <p className="text-ink-3 text-[13.5px]">
          Test results and whether the quality gate is clear to move on.
        </p>
      </div>
      <QualityClient id={params.id} canEdit={canEditBusinessCase(role)} />
    </>
  )
}
