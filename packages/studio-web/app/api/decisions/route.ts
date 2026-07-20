import { platformFetch } from '@/lib/platform'

export async function GET() {
  try {
    return Response.json(await platformFetch('/studio/decisions'))
  } catch {
    return Response.json([], { status: 200 })
  }
}
