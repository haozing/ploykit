import createMiddleware from 'next-intl/middleware';
import { locales, defaultLocale } from './i18n/config';
import { NextRequest, NextResponse } from 'next/server';
import {
  createApiSecurityResponse,
  getApiSecurityDecision,
} from './lib/security/api-security-middleware';
import {
  applyApiRateLimitHeaders,
  createApiRateLimitResponse,
  getApiRateLimitDecision,
} from './lib/security/api-rate-limit-middleware';
import { applySecurityHeaders } from './lib/security/security-headers';
import {
  createMissingStripeSignatureResponse,
  shouldRejectUnsignedStripeWebhook,
} from './lib/security/stripe-webhook-proxy-guard';

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
});

const NON_LOCALIZED_APP_PATHS = new Set(['/opengraph-image']);

function applyRequestMetadata(request: NextRequest): NextRequest {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  requestHeaders.set('x-url', request.url);
  requestHeaders.set('x-request-id', request.headers.get('x-request-id') || crypto.randomUUID());

  return new NextRequest(request, {
    headers: requestHeaders,
  });
}

/**
 * Internationalization Proxy (Next.js 16+)
 *
 * Adds language prefix to all pages, ensuring multi-language support
 * Example: /admin → /zh/admin
 *          /welcome/settings → /zh/welcome/settings
 */
export function proxy(request: NextRequest) {
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID();

  if (request.nextUrl.pathname === '/api' || request.nextUrl.pathname.startsWith('/api/')) {
    const decision = getApiSecurityDecision(request);
    if (decision.action !== 'allow') {
      const response = createApiSecurityResponse(decision, requestId);
      response.headers.set('x-request-id', requestId);
      return applySecurityHeaders(response);
    }

    if (shouldRejectUnsignedStripeWebhook(request)) {
      return createMissingStripeSignatureResponse(requestId);
    }

    const rateLimitDecision = getApiRateLimitDecision(request);
    if (rateLimitDecision.action !== 'allow') {
      const response = createApiRateLimitResponse(rateLimitDecision, requestId);
      response.headers.set('x-request-id', requestId);
      return applySecurityHeaders(response);
    }

    const response = NextResponse.next();
    response.headers.set('x-request-id', requestId);
    applyApiRateLimitHeaders(response, rateLimitDecision);
    return applySecurityHeaders(response);
  }

  if (NON_LOCALIZED_APP_PATHS.has(request.nextUrl.pathname)) {
    const response = NextResponse.next();
    response.headers.set('x-request-id', requestId);
    response.headers.set('x-pathname', request.nextUrl.pathname);
    response.headers.set('x-url', request.url);
    return applySecurityHeaders(response);
  }

  const requestWithMetadata = applyRequestMetadata(request);

  // All routes go through internationalization middleware
  const response = intlMiddleware(requestWithMetadata);

  // Expose metadata both to downstream server code and to response diagnostics.
  response.headers.set('x-pathname', request.nextUrl.pathname);
  response.headers.set('x-url', request.url);
  response.headers.set('x-request-id', requestId);

  return applySecurityHeaders(response);
}

export const config = {
  // Match all app/API paths except Next.js internal files and static assets.
  matcher: ['/((?!_next|_vercel|.*\\..*).*)'],
};
