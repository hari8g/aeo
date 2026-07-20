import { auth } from '@/auth'
import { canEditBusinessCase } from '@/lib/roles'
import { platformFetch } from '@/lib/platform'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!canEditBusinessCase((session?.user as { role?: string } | undefined)?.role)) {
    return Response.json({ error: 'Viewers cannot run effort estimates' }, { status: 403 })
  }

  try {
    return Response.json(
      await platformFetch(`/studio/business-cases/${params.id}/estimate-effort`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    )
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Estimate failed' },
      { status: 500 },
    )
  }
}
