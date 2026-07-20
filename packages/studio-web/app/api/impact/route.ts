import { platformFetch } from '@/lib/platform'

export async function GET() {
  try {
    return Response.json(await platformFetch('/studio/impact'))
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Failed to load impact' },
      { status: 500 },
    )
  }
}
