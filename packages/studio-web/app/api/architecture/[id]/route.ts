import { platformFetch } from '@/lib/platform'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    return Response.json(await platformFetch(`/studio/architecture/${params.id}`))
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Failed to load architecture' },
      { status: 500 },
    )
  }
}
