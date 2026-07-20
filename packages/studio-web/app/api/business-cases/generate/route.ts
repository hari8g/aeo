import { auth } from '@/auth'
import { canEditBusinessCase } from '@/lib/roles'
import { platformFetch } from '@/lib/platform'

export async function POST(req: Request) {
  const session = await auth()
  if (!canEditBusinessCase((session?.user as { role?: string } | undefined)?.role)) {
    return Response.json({ error: 'Viewers cannot create business cases' }, { status: 403 })
  }

  const body = (await req.json()) as { painPointIds?: number[] }
  try {
    const result = await platformFetch<{ briefId: number; featureId: number; cycleId: string }>(
      '/studio/business-cases/generate',
      { method: 'POST', body: JSON.stringify({ painPointIds: body.painPointIds ?? [] }) },
    )
    return Response.json(result)
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Generate failed' },
      { status: 500 },
    )
  }
}
