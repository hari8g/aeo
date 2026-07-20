import { auth } from '@/auth'
import { canEditBusinessCase } from '@/lib/roles'
import { platformFetch } from '@/lib/platform'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!canEditBusinessCase((session?.user as { role?: string } | undefined)?.role)) {
    return Response.json({ error: 'Viewers cannot assemble portfolio packets' }, { status: 403 })
  }

  try {
    return Response.json(
      await platformFetch(`/studio/portfolio/${params.id}/assemble`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    )
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Assemble failed' },
      { status: 500 },
    )
  }
}
