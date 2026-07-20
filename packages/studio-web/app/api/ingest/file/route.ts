import { NextRequest } from 'next/server'
import { PLATFORM_URL, STUDIO_SECRET } from '@/lib/platform'

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const res = await fetch(`${PLATFORM_URL}/ingest/file`, {
    method: 'POST',
    headers: { 'X-Studio-Secret': STUDIO_SECRET },
    body: form,
  })
  const data = await res.json().catch(() => ({ error: 'ingest failed' }))
  return Response.json(data, { status: res.status })
}
