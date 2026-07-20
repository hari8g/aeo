import { auth } from '@/auth'
import { canEditBusinessCase } from '@/lib/roles'
import { platformFetch } from '@/lib/platform'

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!canEditBusinessCase((session?.user as { role?: string } | undefined)?.role)) {
    return Response.json({ error: 'Viewers cannot edit business cases' }, { status: 403 })
  }

  const body = (await req.json()) as { field?: string; value?: string }
  try {
    return Response.json(
      await platformFetch(`/studio/business-cases/${params.id}/field`, {
        method: 'PATCH',
        body: JSON.stringify({ field: body.field, value: body.value }),
      }),
    )
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Save failed' },
      { status: 500 },
    )
  }
}
