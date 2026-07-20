import { platformFetch } from '@/lib/platform'

export async function GET() {
  try {
    return Response.json(await platformFetch('/studio/domain'))
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Failed to load domain models' },
      { status: 500 },
    )
  }
}
