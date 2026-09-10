import { platformFetch } from '@/lib/platform'

export async function GET() {
  try {
    return Response.json(await platformFetch('/studio/gtm/segments'))
  } catch (e) {
    return Response.json({ segments: [] }, { status: 200 })
  }
}
