import { NextRequest, NextResponse } from 'next/server';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface ApiSecurityConfig {
  nodeEnv: string;
  appUrl?: string;
  authUrl?: string;
  serviceToken?: string;
}

export type ApiSecurityDecision =
  | { action: 'allow' }
  | {
      action: 'block';
      status: number;
      code:
        | 'DEBUG_ROUTE_DISABLED'
        | 'MOCK_ROUTE_DISABLED'
        | 'ORIGIN_GUARD_DENIED'
        | 'CSRF_GUARD_DENIED';
      message: string;
      empty?: boolean;
    };

function readApiSecurityConfig(): ApiSecurityConfig {
  return {
    // Proxy code must stay edge-safe, so it reads process.env directly instead of importing env.ts.
    // eslint-disable-next-line no-restricted-syntax
    nodeEnv: process.env.NODE_ENV || 'development',
    // eslint-disable-next-line no-restricted-syntax
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    // eslint-disable-next-line no-restricted-syntax
    authUrl: process.env.BETTER_AUTH_URL,
    // eslint-disable-next-line no-restricted-syntax
    serviceToken: process.env.API_SERVICE_TOKEN,
  };
}

function isDebugApiRoute(pathname: string): boolean {
  return pathname === '/api/debug' || pathname.startsWith('/api/debug/');
}

function isMockBillingApiRoute(pathname: string): boolean {
  return (
    pathname === '/api/billing/products' ||
    pathname.startsWith('/api/billing/products/') ||
    pathname === '/api/billing/skus' ||
    pathname.startsWith('/api/billing/skus/') ||
    pathname === '/api/billing/orders' ||
    pathname === '/api/billing/subscriptions'
  );
}

function isPluginWebhookRoute(pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean);
  return (
    parts[0] === 'api' && parts[1] === 'plugins' && Boolean(parts[2]) && parts[3] === 'webhooks'
  );
}

function isPluginFileRoute(pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean);
  return parts[0] === 'api' && parts[1] === 'plugin-files' && Boolean(parts[2]);
}

function isPluginAssetRoute(pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean);
  return parts[0] === 'api' && parts[1] === 'plugin-assets' && Boolean(parts[2]);
}

function isMutationGuardExempt(pathname: string): boolean {
  return (
    pathname === '/api/auth' ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/api/webhooks/') ||
    isPluginWebhookRoute(pathname) ||
    isPluginFileRoute(pathname) ||
    isPluginAssetRoute(pathname)
  );
}

function hasVerifiedMachineAuth(request: NextRequest, config: ApiSecurityConfig): boolean {
  if (!config.serviceToken) {
    return false;
  }

  const serviceToken = request.headers.get('x-service-token');
  return serviceToken === config.serviceToken;
}

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getAllowedOrigins(request: NextRequest, config: ApiSecurityConfig): string[] {
  const origins = new Set<string>();
  const appOrigin = normalizeOrigin(config.appUrl);
  const authOrigin = normalizeOrigin(config.authUrl);

  if (appOrigin) origins.add(appOrigin);
  if (authOrigin) origins.add(authOrigin);

  if (config.nodeEnv !== 'production') {
    origins.add(request.nextUrl.origin);
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
  }

  return [...origins];
}

function hasAllowedOrigin(request: NextRequest, config: ApiSecurityConfig): boolean {
  const allowedOrigins = getAllowedOrigins(request, config);
  const origin = request.headers.get('origin');

  if (origin) {
    return allowedOrigins.includes(origin);
  }

  const referer = request.headers.get('referer');
  if (referer) {
    const refererOrigin = normalizeOrigin(referer);
    return refererOrigin ? allowedOrigins.includes(refererOrigin) : false;
  }

  return config.nodeEnv !== 'production';
}

function hasCsrfSignal(request: NextRequest): boolean {
  if (request.headers.get('x-requested-with')) {
    return true;
  }

  if (request.headers.get('x-csrf-token')) {
    return true;
  }

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return true;
  }

  const fetchSite = request.headers.get('sec-fetch-site');
  return fetchSite === 'same-origin' || fetchSite === 'same-site';
}

export function getApiSecurityDecision(
  request: NextRequest,
  config = readApiSecurityConfig()
): ApiSecurityDecision {
  const pathname = request.nextUrl.pathname;
  const method = request.method.toUpperCase();

  if (isDebugApiRoute(pathname) && config.nodeEnv === 'production') {
    return {
      action: 'block',
      status: 404,
      code: 'DEBUG_ROUTE_DISABLED',
      message: 'Not found',
      empty: true,
    };
  }

  if (isMockBillingApiRoute(pathname) && config.nodeEnv === 'production') {
    return {
      action: 'block',
      status: 404,
      code: 'MOCK_ROUTE_DISABLED',
      message: 'Not found',
      empty: true,
    };
  }

  if (!STATE_CHANGING_METHODS.has(method) || SAFE_METHODS.has(method)) {
    return { action: 'allow' };
  }

  if (isMutationGuardExempt(pathname) || hasVerifiedMachineAuth(request, config)) {
    return { action: 'allow' };
  }

  if (!hasAllowedOrigin(request, config)) {
    return {
      action: 'block',
      status: 403,
      code: 'ORIGIN_GUARD_DENIED',
      message: 'Invalid origin',
    };
  }

  if (!hasCsrfSignal(request)) {
    return {
      action: 'block',
      status: 403,
      code: 'CSRF_GUARD_DENIED',
      message: 'CSRF validation failed',
    };
  }

  return { action: 'allow' };
}

export function createApiSecurityResponse(
  decision: Exclude<ApiSecurityDecision, { action: 'allow' }>,
  requestId?: string
) {
  if (decision.empty) {
    const response = new NextResponse(null, { status: decision.status });
    if (requestId) {
      response.headers.set('x-request-id', requestId);
    }
    return response;
  }

  return NextResponse.json(
    {
      success: false,
      code: decision.code,
      error: {
        code: decision.code,
        message: decision.message,
        statusCode: decision.status,
        fix:
          decision.code === 'ORIGIN_GUARD_DENIED'
            ? 'Send state-changing browser requests from the configured app origin.'
            : 'Send state-changing browser requests with a CSRF signal, or use a signed machine endpoint.',
      },
      requestId,
    },
    { status: decision.status }
  );
}
