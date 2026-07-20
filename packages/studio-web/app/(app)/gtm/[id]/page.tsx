import { auth } from '@/auth'
import { canEditBusinessCase } from '@/lib/roles'
import { platformFetch } from '@/lib/platform'
import GtmClient from './GtmClient'

export default async function GtmDetailPage({ params }: { params: { id: string } }) {
  const session = await auth()
  const role = (session?.user as { role?: string } | undefined)?.role
  let title = 'Go-to-market'
  try {
    const detail = await platformFetch<{ title: string }>(`/studio/gtm/${params.id}`)
    title = detail.title || title
  } catch {
    /* client will show error */
  }

  return (
    <>
      <div className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-bosch-muted mb-1">
          Decide · Go-to-Market
        </p>
        <h1 className="text-[22px] font-extrabold tracking-tight mb-1">{title}</h1>
        <p className="text-ink-3 text-[13.5px]">
          Who this is for, how we&apos;d talk about it, and whether it&apos;s an easy sell.
        </p>
      </div>
      <GtmClient id={params.id} canEdit={canEditBusinessCase(role)} />
    </>
  )
}
