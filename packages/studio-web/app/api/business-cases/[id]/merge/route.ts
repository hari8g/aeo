import { auth } from '@/auth'
import { canEditBusinessCase } from '@/lib/roles'
import { platformFetch } from '@/lib/platform'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!canEditBusinessCase((session?.user as { role?: string } | undefined)?.role)) {
    return Response.json({ error: 'Viewers cannot merge business cases' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { mergeIntoFeatureId?: number }
  try {
    return Response.json(
      await platformFetch(`/studio/business-cases/${params.id}/merge`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    )
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Merge failed' },
      { status: 500 },
    )
  }
}
