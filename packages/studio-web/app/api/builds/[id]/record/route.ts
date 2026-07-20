import { auth } from '@/auth'
import { canEditBusinessCase } from '@/lib/roles'
import { platformFetch } from '@/lib/platform'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!canEditBusinessCase((session?.user as { role?: string } | undefined)?.role)) {
    return Response.json({ error: 'Viewers cannot record pipeline builds' }, { status: 403 })
  }

  try {
    return Response.json(
      await platformFetch(`/studio/builds/${params.id}/record`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    )
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Record failed' },
      { status: 500 },
    )
  }
}
