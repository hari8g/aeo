import { platformFetch } from '@/lib/platform'

export async function GET() {
  try {
    return Response.json(await platformFetch('/studio/lessons'))
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Failed to load lessons' },
      { status: 500 },
    )
  }
}
