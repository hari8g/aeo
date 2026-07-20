import { auth } from '@/auth'
import { platformFetch } from '@/lib/platform'

export async function GET() {
  try {
    return Response.json(await platformFetch('/team/approvers'))
  } catch {
    return Response.json([], { status: 200 })
  }
}

export async function POST(req: Request) {
  const session = await auth()
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return Response.json({ error: 'Admin only' }, { status: 403 })
  }
  const body = (await req.json()) as { userId?: string; title?: string }
  try {
    return Response.json(
      await platformFetch('/team/approvers', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    )
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 },
    )
  }
}
