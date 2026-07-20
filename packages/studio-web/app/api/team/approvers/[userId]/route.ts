import { auth } from '@/auth'
import { platformFetch } from '@/lib/platform'

export async function DELETE(_req: Request, { params }: { params: { userId: string } }) {
  const session = await auth()
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return Response.json({ error: 'Admin only' }, { status: 403 })
  }
  try {
    return Response.json(
      await platformFetch(`/team/approvers/${params.userId}`, { method: 'DELETE' }),
    )
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 },
    )
  }
}
