import { platformFetch } from '@/lib/platform'
import PortfolioClient from './PortfolioClient'

export default async function PortfolioDetailPage({ params }: { params: { id: string } }) {
  let title = 'Portfolio review'
  try {
    const detail = await platformFetch<{ title: string }>(`/studio/portfolio/${params.id}`)
    title = detail.title || title
  } catch {
    /* client will show error */
  }

  return (
    <>
      <div className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-bosch-muted mb-1">
          Decide · Portfolio Review
        </p>
        <h1 className="text-[22px] font-extrabold tracking-tight mb-1">{title}</h1>
        <p className="text-ink-3 text-[13.5px]">
          Review the full evidence packet, then record Admit, Defer, or Reject.
        </p>
      </div>
      <PortfolioClient id={params.id} />
    </>
  )
}
