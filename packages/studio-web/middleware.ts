import { getToken } from 'next-auth/jwt'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const ADMIN_ONLY = ['/settings', '/access']

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname

  if (
    path.startsWith('/api/public-settings') ||
    path.startsWith('/api/demo/') ||
    path.startsWith('/api/team/accept-invite') ||
    (path.startsWith('/api/team/invite') && req.method === 'GET')
  ) {
    return NextResponse.next()
  }

  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  })

  if (!token) {
    if (path.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const role = (token.role as string | undefined) ?? 'viewer'
  if (ADMIN_ONLY.some((p) => path.startsWith(p)) && role !== 'admin') {
    return NextResponse.redirect(new URL('/', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!login|accept-invite|api/auth|brand|_next/static|_next/image|favicon.ico).*)',
  ],
}
