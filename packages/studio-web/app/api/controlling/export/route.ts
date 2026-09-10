import { PLATFORM_URL, STUDIO_SECRET } from '@/lib/platform'

export async function GET() {
  try {
    const res = await fetch(`${PLATFORM_URL}/studio/controlling/export`, {
      headers: { 'X-Studio-Secret': STUDIO_SECRET },
      cache: 'no-store',
    })
    if (!res.ok) {
      return new Response(await res.text(), { status: res.status })
    }
    const csv = await res.text()
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="mps-portfolio-by-class.csv"',
      },
    })
  } catch (e) {
    return new Response(e instanceof Error ? e.message : 'Export failed', { status: 500 })
  }
}
