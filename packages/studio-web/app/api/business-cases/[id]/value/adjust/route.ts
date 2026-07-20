import { auth } from '@/auth'
import { canEditBusinessCase } from '@/lib/roles'
import { platformFetch } from '@/lib/platform'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!canEditBusinessCase((session?.user as { role?: string } | undefined)?.role)) {
    return Response.json({ error: 'Viewers cannot adjust value assumptions' }, { status: 403 })
  }

  const body = (await req.json()) as { assumptions?: string[] }
  try {
    return Response.json(
      await platformFetch(`/studio/business-cases/${params.id}/value/adjust`, {
        method: 'POST',
        body: JSON.stringify({ assumptions: body.assumptions ?? [] }),
      }),
    )
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Re-estimate failed' },
      { status: 500 },
    )
  }
}
