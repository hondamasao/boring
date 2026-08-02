import { NextResponse, type NextRequest } from 'next/server';

/**
 * Gates /internal with real HTTP Basic Auth, checked against
 * INTERNAL_DASHBOARD_PASSWORD. That page aggregates every customer's
 * confirmed bill data in one place, unlike the per-upload pages (which rely
 * on their link being unguessable) — so this fails closed: no password
 * configured means no access, not an open page.
 */

function unauthorized(): NextResponse {
  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Internal", charset="UTF-8"' },
  });
}

export function proxy(request: NextRequest): NextResponse {
  const password = process.env.INTERNAL_DASHBOARD_PASSWORD;
  if (!password) return unauthorized();

  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Basic ')) return unauthorized();

  const decoded = Buffer.from(auth.slice('Basic '.length), 'base64').toString('utf8');
  const providedPassword = decoded.slice(decoded.indexOf(':') + 1);
  if (providedPassword !== password) return unauthorized();

  return NextResponse.next();
}

export const config = {
  matcher: '/internal/:path*',
};
