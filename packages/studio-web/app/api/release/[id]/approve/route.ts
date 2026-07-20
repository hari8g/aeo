import { auth } from '@/auth'
import { canEditBusinessCase } from '@/lib/roles'
import { platformFetch } from '@/lib/platform'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!canEditBusinessCase((session?.user as { role?: string } | undefined)?.role)) {
    return Response.json({ error: 'Viewers cannot approve release' }, { status: 403 })
  }

  try {
    return Response.json(
      await platformFetch(`/studio/release/${params.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ role: 'all' }),
      }),
    )
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Approve failed' },
      { status: 500 },
    )
  }
}
