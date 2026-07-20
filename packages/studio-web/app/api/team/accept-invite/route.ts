import { platformFetch } from '@/lib/platform'

export async function POST(req: Request) {
  const body = await req.json()
  try {
    return Response.json(
      await platformFetch('/team/accept-invite', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    )
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
