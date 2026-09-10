import { platformFetch } from '@/lib/platform'

export async function GET() {
  try {
    return Response.json(await platformFetch('/studio/office/state'))
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
