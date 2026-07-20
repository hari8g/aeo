import { platformFetch } from '@/lib/platform'

export async function GET() {
  try {
    return Response.json(await platformFetch('/settings'))
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const body = await req.json()
  try {
    return Response.json(
      await platformFetch('/settings', { method: 'PATCH', body: JSON.stringify(body) }),
    )
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
