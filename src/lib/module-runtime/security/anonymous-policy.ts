import type { ModuleApiRoute } from '@ploykit/module-sdk';

export interface ModuleAnonymousPolicyRequestInput {
  moduleId: string;
  route: ModuleApiRoute;
  request: Request;
  userId?: string | null;
  anonymous: boolean;
  now?: () => number;
}

export interface ModuleAnonymousPolicyPlan {
  routePath: string;
  rateLimit: ModuleApiRoute['anonymousPolicy'] extends infer T
    ? T extends { rateLimit?: infer R }
      ? R | null
      : null
    : null;
  allowHighCostActions: boolean;
  maxUploadBytes: number | null;
  captcha: 'never' | 'auto' | 'always';
}

interface RateLimitBucketState {
  windowStart: number;
  count: number;
}

const rateLimitBuckets = new Map<string, RateLimitBucketState>();

export function createModuleAnonymousPolicyPlan(route: ModuleApiRoute): ModuleAnonymousPolicyPlan {
  return {
    routePath: route.path,
    rateLimit: route.anonymousPolicy?.rateLimit ?? null,
    allowHighCostActions: route.anonymousPolicy?.allowHighCostActions ?? false,
    maxUploadBytes: route.anonymousPolicy?.maxUploadBytes ?? null,
    captcha: route.anonymousPolicy?.captcha ?? 'never',
  };
}

function parseDurationMs(value: string): number | null {
  const match = value.trim().match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return null;
  }
  switch (unit) {
    case 'ms':
      return amount;
    case 's':
      return amount * 1000;
    case 'm':
      return amount * 60 * 1000;
    case 'h':
      return amount * 60 * 60 * 1000;
    case 'd':
      return amount * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

function clientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (
    forwardedFor ||
    request.headers.get('x-real-ip')?.trim() ||
    request.headers.get('cf-connecting-ip')?.trim() ||
    'unknown'
  );
}

function bucketParts(input: ModuleAnonymousPolicyRequestInput): string[] {
  const bucket = input.route.anonymousPolicy?.rateLimit?.bucket ?? 'route';
  const buckets = Array.isArray(bucket) ? bucket : [bucket];
  return buckets.map((item) => {
    switch (item) {
      case 'ip':
        return `ip:${clientIp(input.request)}`;
      case 'userAgent':
        return `ua:${input.request.headers.get('user-agent') ?? 'unknown'}`;
      case 'route':
        return `route:${input.route.path}`;
      case 'module':
        return `module:${input.moduleId}`;
      case 'method':
        return `method:${input.request.method.toUpperCase()}`;
      default:
        return `${item}`;
    }
  });
}

function requestBodySize(request: Request): number | null {
  const contentLength = request.headers.get('content-length');
  if (!contentLength) {
    return null;
  }
  const parsed = Number(contentLength);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, code, message }, { status });
}

export function checkModuleAnonymousPolicy(
  input: ModuleAnonymousPolicyRequestInput
): Response | null {
  const plan = createModuleAnonymousPolicyPlan(input.route);
  const size = requestBodySize(input.request);
  if (plan.maxUploadBytes !== null && size !== null && size > plan.maxUploadBytes) {
    return jsonError(
      413,
      'MODULE_API_ANONYMOUS_UPLOAD_TOO_LARGE',
      'Anonymous upload exceeds the route limit.'
    );
  }

  if (!input.anonymous) {
    return null;
  }

  if (input.route.commercial && !plan.allowHighCostActions) {
    return jsonError(
      403,
      'MODULE_API_ANONYMOUS_HIGH_COST_DENIED',
      'Anonymous access is not allowed for this high-cost API route.'
    );
  }

  if (plan.captcha === 'always') {
    return jsonError(
      403,
      'MODULE_API_ANONYMOUS_CAPTCHA_REQUIRED',
      'Captcha verification is required for this anonymous API route.'
    );
  }

  if (plan.rateLimit) {
    const windowMs = parseDurationMs(plan.rateLimit.window);
    if (windowMs) {
      const now = input.now?.() ?? Date.now();
      const key = [
        'module-api-anonymous',
        input.moduleId,
        input.route.path,
        ...bucketParts(input),
      ].join('|');
      const current = rateLimitBuckets.get(key);
      const state =
        current && now - current.windowStart < windowMs
          ? current
          : { windowStart: now, count: 0 };
      state.count += 1;
      rateLimitBuckets.set(key, state);
      if (state.count > plan.rateLimit.limit) {
        return jsonError(
          429,
          'MODULE_API_ANONYMOUS_RATE_LIMITED',
          'Anonymous API route rate limit exceeded.'
        );
      }
    }
  }

  return null;
}

export function resetModuleAnonymousPolicyRateLimitsForTests(): void {
  rateLimitBuckets.clear();
}
