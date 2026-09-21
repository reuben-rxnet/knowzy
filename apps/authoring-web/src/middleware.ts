import { NextResponse, type NextRequest } from 'next/server';

/**
 * Supplies the current pathname to the layout.
 *
 * Next's App Router does not give a layout its own pathname, and the shell
 * needs it to mark the active navigation item. The two alternatives were worse:
 * making the sidebar a client component would couple the design system to
 * `next/navigation` and pull the shell into the client bundle, and threading a
 * prop from every page would repeat the same line eleven times.
 *
 * This adds a request header and nothing else. It sets no cookie, reads no
 * body, makes no authorization decision, and changes no response: authorization
 * stays server-side in the API, exactly as before (invariant 8).
 */
export const middleware = (request: NextRequest): NextResponse => {
  const requestHeaders = new Headers(request.headers);
  // Pathname and query: the sidebar distinguishes a queue of a route
  // (`/review?queue=approval`) from the route itself.
  requestHeaders.set('x-knowzy-path', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.next({ request: { headers: requestHeaders } });
};

export const config = {
  // Skip Next's own assets and the favicon: they never render a shell.
  matcher: ['/((?!_next/static|_next/image|icon.svg|favicon.ico).*)'],
};
