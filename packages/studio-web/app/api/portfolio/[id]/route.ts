import { auth } from '@/auth'
import { platformFetch } from '@/lib/platform'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  const userId = (session?.user as { id?: string } | undefined)?.id
  const qs = userId ? `?userId=${encodeURIComponent(userId)}` : ''
  try {
    return Response.json(await platformFetch(`/studio/portfolio/${params.id}${qs}`))
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Not found' },
      { status: 404 },
    )
  }
}
