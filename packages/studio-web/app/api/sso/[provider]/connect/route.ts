import { platformFetch } from '@/lib/platform'

export async function POST(req: Request, { params }: { params: { provider: string } }) {
  const body = await req.json()
  try {
    return Response.json(
      await platformFetch(`/sso/${params.provider}/connect`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    )
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
