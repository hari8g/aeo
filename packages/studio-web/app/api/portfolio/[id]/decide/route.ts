import { auth } from '@/auth'
import { platformFetch } from '@/lib/platform'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) {
    return Response.json({ error: 'Not signed in' }, { status: 401 })
  }

  const body = (await req.json()) as {
    decision?: string
    role?: string
    rationale?: string
  }

  try {
    return Response.json(
      await platformFetch(`/studio/portfolio/${params.id}/decide`, {
        method: 'POST',
        body: JSON.stringify({
          decision: body.decision,
          role: body.role,
          rationale: body.rationale,
          userId,
        }),
      }),
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Decide failed'
    const status = msg.includes('403') ? 403 : 500
    return Response.json({ error: msg }, { status })
  }
}
