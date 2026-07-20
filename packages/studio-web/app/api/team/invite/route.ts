import { auth } from '@/auth'
import { platformFetch } from '@/lib/platform'

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token')
  if (!token) return Response.json({ error: 'token required' }, { status: 400 })
  try {
    return Response.json(await platformFetch(`/team/invite?token=${encodeURIComponent(token)}`))
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 404 })
  }
}

export async function POST(req: Request) {
  const session = await auth()
  const body = await req.json()
  try {
    return Response.json(
      await platformFetch('/team/invite', {
        method: 'POST',
        body: JSON.stringify({
          ...body,
          invitedBy: (session?.user as { id?: string } | undefined)?.id,
        }),
      }),
    )
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
