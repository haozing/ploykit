import { NextRequest, NextResponse } from 'next/server';

interface ApiRateLimitPolicy {
  id: string;
  windowMs: number;
  maxRequests: number;
  message: string;
  key: (request: NextRequest) => string;
}

interface ApiRateLimitRecord {
  count: number;
  resetTime: number;
}

export type ApiRateLimitDecision =
  | {
      action: 'allow';
      policyId?: string;
      headers?: Record<string, string>;
    }
  | {
      action: 'block';
      status: 429;
      code: 'RATE_LIMITED';
      message: string;
      retryAfter: number;
      headers: Record<string, string>;
    };

const store = new Map<string, ApiRateLimitRecord>();

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

function isPluginWebhookRoute(pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean);
  return (
    parts[0] === 'api' && parts[1] === 'plugins' && Boolean(parts[2]) && parts[3] === 'webhooks'
  );
}

function getWebhookProvider(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);

  if (isPluginWebhookRoute(pathname)) {
    return `plugin:${parts[2] ?? 'unknown'}`;
  }

  return parts[2] || 'unknown';
}

function getWebhookKey(request: NextRequest): string {
  const signature =
    request.headers.get('stripe-signature') ||
    request.headers.get('webhook-signature') ||
    request.headers.get('x-ploykit-signature') ||
    request.headers.get('x-hub-signature-256') ||
    request.headers.get('authorization') ||
    'unsigned';

  const signatureBucket =
    signature === 'unsigned' ? 'unsigned' : `signed:${signature.slice(0, 32)}`;
  return [
    'api-rate-limit',
    'webhook',
    getWebhookProvider(request.nextUrl.pathname),
    getClientIp(request),
    signatureBucket,
  ].join(':');
}

function getPolicy(request: NextRequest): ApiRateLimitPolicy | null {
  const pathname = request.nextUrl.pathname;
  const method = request.method.toUpperCase();

  if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) {
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return {
        id: 'auth-read',
        windowMs: 60 * 1000,
        maxRequests: 120,
        message: 'Authentication API rate limit exceeded.',
        key: (req) =>
          ['api-rate-limit', 'auth-read', getClientIp(req), req.nextUrl.pathname].join(':'),
      };
    }

    return {
      id: 'auth-write',
      windowMs: 15 * 60 * 1000,
      maxRequests: 30,
      message: 'Too many authentication attempts, please try again later.',
      key: (req) =>
        ['api-rate-limit', 'auth-write', getClientIp(req), req.nextUrl.pathname].join(':'),
    };
  }

  if (pathname === '/api/contact' && method === 'POST') {
    return {
      id: 'contact',
      windowMs: 60 * 1000,
      maxRequests: 10,
      message: 'Too many contact submissions, please try again later.',
      key: (req) => ['api-rate-limit', 'contact', getClientIp(req)].join(':'),
    };
  }

  if (
    (pathname === '/api/checkout/create' || pathname === '/api/billing/portal') &&
    method === 'POST'
  ) {
    return {
      id: 'billing-action',
      windowMs: 60 * 1000,
      maxRequests: 10,
      message: 'Billing action rate limit exceeded.',
      key: (req) =>
        ['api-rate-limit', 'billing-action', getClientIp(req), req.nextUrl.pathname].join(':'),
    };
  }

  if (
    pathname === '/api/webhooks' ||
    pathname.startsWith('/api/webhooks/') ||
    isPluginWebhookRoute(pathname)
  ) {
    const hasSignature =
      request.headers.has('stripe-signature') ||
      request.headers.has('webhook-signature') ||
      request.headers.has('x-ploykit-signature') ||
      request.headers.has('x-hub-signature-256') ||
      request.headers.has('authorization');

    return {
      id: hasSignature ? 'webhook-signed' : 'webhook-unsigned',
      windowMs: 60 * 1000,
      maxRequests: hasSignature ? 600 : 30,
      message: 'Webhook request rate limit exceeded.',
      key: getWebhookKey,
    };
  }

  if (pathname === '/api/plugins' || pathname.startsWith('/api/plugins/')) {
    return {
      id: 'plugin-api',
      windowMs: 60 * 1000,
      maxRequests: 120,
      message: 'Plugin API rate limit exceeded.',
      key: (req) =>
        [
          'api-rate-limit',
          'plugin-api',
          getClientIp(req),
          req.method.toUpperCase(),
          req.nextUrl.pathname,
        ].join(':'),
    };
  }

  return null;
}

function buildHeaders(policy: ApiRateLimitPolicy, remaining: number, resetTime: number) {
  return {
    'X-RateLimit-Policy': policy.id,
    'X-RateLimit-Limit': policy.maxRequests.toString(),
    'X-RateLimit-Remaining': Math.max(0, remaining).toString(),
    'X-RateLimit-Reset': new Date(resetTime).toISOString(),
  };
}

export function getApiRateLimitDecision(
  request: NextRequest,
  now: number = Date.now()
): ApiRateLimitDecision {
  const policy = getPolicy(request);

  if (!policy) {
    return { action: 'allow' };
  }

  const key = policy.key(request);
  const record = store.get(key);

  if (!record || record.resetTime <= now) {
    const resetTime = now + policy.windowMs;
    store.set(key, { count: 1, resetTime });

    return {
      action: 'allow',
      policyId: policy.id,
      headers: buildHeaders(policy, policy.maxRequests - 1, resetTime),
    };
  }

  if (record.count < policy.maxRequests) {
    record.count += 1;

    return {
      action: 'allow',
      policyId: policy.id,
      headers: buildHeaders(policy, policy.maxRequests - record.count, record.resetTime),
    };
  }

  const retryAfter = Math.max(1, Math.ceil((record.resetTime - now) / 1000));

  return {
    action: 'block',
    status: 429,
    code: 'RATE_LIMITED',
    message: policy.message,
    retryAfter,
    headers: {
      ...buildHeaders(policy, 0, record.resetTime),
      'Retry-After': retryAfter.toString(),
    },
  };
}

export function applyApiRateLimitHeaders(response: NextResponse, decision: ApiRateLimitDecision) {
  if (!('headers' in decision) || !decision.headers) {
    return response;
  }

  for (const [key, value] of Object.entries(decision.headers)) {
    response.headers.set(key, value);
  }

  return response;
}

export function createApiRateLimitResponse(
  decision: Exclude<ApiRateLimitDecision, { action: 'allow' }>,
  requestId: string
) {
  return NextResponse.json(
    {
      success: false,
      code: decision.code,
      error: {
        code: decision.code,
        message: decision.message,
        statusCode: decision.status,
        retryAfter: decision.retryAfter,
        fix: 'Wait before retrying this endpoint or reduce client request concurrency.',
      },
      requestId,
    },
    {
      status: decision.status,
      headers: decision.headers,
    }
  );
}

export function clearApiRateLimitStore(): void {
  store.clear();
}
