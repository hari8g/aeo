import { auth } from '@/auth'
import { canEditBusinessCase } from '@/lib/roles'
import { platformFetch } from '@/lib/platform'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!canEditBusinessCase((session?.user as { role?: string } | undefined)?.role)) {
    return Response.json({ error: 'Viewers cannot run value estimates' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { assumptions?: string[] }
  try {
    return Response.json(
      await platformFetch(`/studio/business-cases/${params.id}/estimate-value`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    )
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Estimate failed' },
      { status: 500 },
    )
  }
}
