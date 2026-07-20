import { auth } from '@/auth'
import { canEditBusinessCase } from '@/lib/roles'
import { platformFetch } from '@/lib/platform'

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!canEditBusinessCase((session?.user as { role?: string } | undefined)?.role)) {
    return Response.json({ error: 'Viewers cannot edit positioning' }, { status: 403 })
  }

  const body = (await req.json()) as { positioning?: string }
  try {
    return Response.json(
      await platformFetch(`/studio/gtm/${params.id}/positioning`, {
        method: 'PATCH',
        body: JSON.stringify({ positioning: body.positioning }),
      }),
    )
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Save failed' },
      { status: 500 },
    )
  }
}
