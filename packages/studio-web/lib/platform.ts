const PLATFORM_URL = process.env.PLATFORM_URL ?? 'http://localhost:7070'
const STUDIO_SECRET = process.env.STUDIO_SECRET ?? 'avp-studio-dev-secret'

export function platformHeaders(json = true): HeadersInit {
  const h: Record<string, string> = { 'X-Studio-Secret': STUDIO_SECRET }
  if (json) h['Content-Type'] = 'application/json'
  return h
}

export async function platformFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData
  const res = await fetch(`${PLATFORM_URL}${path}`, {
    ...init,
    headers: {
      ...platformHeaders(!isForm),
      ...init?.headers,
    },
    cache: 'no-store',
  })
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText)
    throw new Error(`Platform ${path}: ${res.status} ${err}`)
  }
  return res.json() as Promise<T>
}

export { PLATFORM_URL, STUDIO_SECRET }
