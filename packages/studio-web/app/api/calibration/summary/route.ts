import { platformFetch } from '@/lib/platform'

export async function GET() {
  try {
    return Response.json(await platformFetch('/studio/calibration/summary'))
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Failed to load calibration' },
      { status: 500 },
    )
  }
}
