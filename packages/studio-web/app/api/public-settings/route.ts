import { isDemoBypassEnabled } from '@/lib/demo'
import { platformFetch } from '@/lib/platform'

export async function GET() {
  try {
    const data = await platformFetch<{ requireSso: boolean }>('/studio/public/settings')
    return Response.json({ ...data, demoBypass: isDemoBypassEnabled() })
  } catch {
    return Response.json({ requireSso: false, demoBypass: isDemoBypassEnabled() })
  }
}
