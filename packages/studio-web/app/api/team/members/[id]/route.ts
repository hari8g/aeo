import { platformFetch } from '@/lib/platform'

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json()
  try {
    return Response.json(
      await platformFetch(`/team/members/${params.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    )
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    return Response.json(
      await platformFetch(`/team/members/${params.id}`, { method: 'DELETE' }),
    )
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
