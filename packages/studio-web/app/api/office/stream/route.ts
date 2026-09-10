import { PLATFORM_URL, STUDIO_SECRET } from '@/lib/platform'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const res = await fetch(`${PLATFORM_URL}/studio/office/stream`, {
      headers: { 'X-Studio-Secret': STUDIO_SECRET },
      cache: 'no-store',
    })
    if (!res.ok || !res.body) {
      return new Response('stream unavailable', { status: 502 })
    }
    return new Response(res.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
