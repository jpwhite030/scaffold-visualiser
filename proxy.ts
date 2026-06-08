import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';

// Next.js 16: this file used to be `middleware.ts`. It runs on every matched
// request and blocks anyone without a valid session — including the
// /api/analyze endpoint, so the Anthropic key can't be used by the public.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authed = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === '/login') {
    // Already signed in? Skip the login page.
    return authed ? NextResponse.redirect(new URL('/', request.url)) : NextResponse.next();
  }

  if (!authed) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next's internal/static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
