import { auth } from '@/auth'
import { canEditBusinessCase } from '@/lib/roles'
import { platformFetch } from '@/lib/platform'
import ReleaseClient from './ReleaseClient'

export default async function ReleaseDetailPage({ params }: { params: { id: string } }) {
  const session = await auth()
  const role = (session?.user as { role?: string } | undefined)?.role
  let title = 'Release'
  try {
    const detail = await platformFetch<{ title: string }>(`/studio/release/${params.id}`)
    title = detail.title || title
  } catch {
    /* client loads */
  }

  return (
    <>
      <div className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-bosch-muted mb-1">
          Ship · Release
        </p>
        <h1 className="text-[22px] font-extrabold tracking-tight mb-1">{title}</h1>
        <p className="text-ink-3 text-[13.5px]">
          Readiness report and release sign-off for this case.
        </p>
      </div>
      <ReleaseClient id={params.id} canEdit={canEditBusinessCase(role)} />
    </>
  )
}
