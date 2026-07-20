import { auth } from '@/auth'
import { platformFetch } from '@/lib/platform'

export async function GET() {
  const session = await auth()
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) return Response.json({ isApprover: false, count: 0 })
  try {
    return Response.json(
      await platformFetch<{ isApprover: boolean; count: number }>(
        `/studio/portfolio/awaiting?userId=${encodeURIComponent(userId)}`,
      ),
    )
  } catch {
    return Response.json({ isApprover: false, count: 0 })
  }
}
