import { NextResponse, type NextRequest } from 'next/server';
import {
  HOST_LANGUAGE_HEADER,
  HOST_PATHNAME_HEADER,
  languageFromPathname,
} from './lib/i18n';

export function proxy(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const correlationId = request.headers.get('x-correlation-id') ?? requestId;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-request-id', requestId);
  requestHeaders.set('x-correlation-id', correlationId);
  requestHeaders.set(HOST_LANGUAGE_HEADER, languageFromPathname(request.nextUrl.pathname));
  requestHeaders.set(HOST_PATHNAME_HEADER, request.nextUrl.pathname);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set('x-request-id', requestId);
  response.headers.set('x-correlation-id', correlationId);
  response.headers.set('server-timing', `proxy;dur=${Math.max(0, Date.now() - startedAt)}`);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
