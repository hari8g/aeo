import { platformFetch } from '@/lib/platform'

export async function POST(
  _req: Request,
  { params }: { params: { connector: string } },
) {
  try {
    return Response.json(
      await platformFetch(`/connectors/${params.connector}/connect`, { method: 'POST' }),
    )
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
