import { platformFetch } from '@/lib/platform'

export async function GET() {
  try {
    return Response.json(await platformFetch('/studio/portfolio'))
  } catch {
    return Response.json([], { status: 200 })
  }
}
