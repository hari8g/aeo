import { auth } from '@/auth'
import { canEditBusinessCase } from '@/lib/roles'
import { platformFetch } from '@/lib/platform'

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!canEditBusinessCase((session?.user as { role?: string } | undefined)?.role)) {
    return Response.json({ error: 'Viewers cannot update effort risks' }, { status: 403 })
  }

  const body = (await req.json()) as { riskIndex?: number }
  try {
    return Response.json(
      await platformFetch(`/studio/business-cases/${params.id}/effort/risk-addressed`, {
        method: 'PATCH',
        body: JSON.stringify({ riskIndex: body.riskIndex }),
      }),
    )
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Update failed' },
      { status: 500 },
    )
  }
}
