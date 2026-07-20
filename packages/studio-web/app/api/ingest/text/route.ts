import { platformFetch } from '@/lib/platform'

export async function POST(req: Request) {
  const body = await req.json()
  try {
    const data = await platformFetch('/ingest/text', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return Response.json(data)
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}
