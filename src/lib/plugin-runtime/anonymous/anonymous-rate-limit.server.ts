import 'server-only';

import { PluginError, type PluginAnonymousPolicy } from '@ploykit/plugin-sdk';
import type { AnonymousRuntimeRoute } from './anonymous-policy.server';

interface AnonymousLimitRecord {
  count: number;
  resetTime: number;
}

export interface AnonymousRateLimitDecision {
  allowed: boolean;
  retryAfter?: number;
  headers: Record<string, string>;
}

const store = new Map<string, AnonymousLimitRecord>();

function parseWindowMs(window: string): number {
  const match = window.match(/^(\d+)([smhd])$/);
  if (!match) {
    return 60_000;
  }

  const value = Number(match[1]);
  const unit = match[2];
  const multiplier =
    unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;

  return value * multiplier;
}

function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

function getBuckets(policy: NonNullable<PluginAnonymousPolicy['rateLimit']>) {
  return Array.isArray(policy.bucket) ? policy.bucket : [policy.bucket];
}

function buildKey(input: {
  request: Request;
  pluginId: string;
  route: AnonymousRuntimeRoute & { method?: string };
  policy: NonNullable<PluginAnonymousPolicy['rateLimit']>;
}): string {
  const url = new URL(input.request.url);
  const userAgent = input.request.headers.get('user-agent') ?? 'unknown';
  const buckets = getBuckets(input.policy).map((bucket) => {
    switch (bucket) {
      case 'ip':
        return `ip:${getClientIp(input.request)}`;
      case 'userAgent':
        return `ua:${userAgent.slice(0, 120)}`;
      case 'route':
        return `route:${input.route.method ?? input.request.method.toUpperCase()}:${input.route.path}`;
      case 'plugin':
        return `plugin:${input.pluginId}`;
      case 'method':
        return `method:${input.request.method.toUpperCase()}`;
      default:
        return `${bucket}:${url.pathname}`;
    }
  });

  return ['anonymous-api', input.pluginId, ...buckets].join(':');
}

function headers(input: {
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}) {
  const result: Record<string, string> = {
    'X-Anonymous-RateLimit-Limit': String(input.limit),
    'X-Anonymous-RateLimit-Remaining': String(Math.max(0, input.remaining)),
    'X-Anonymous-RateLimit-Reset': new Date(input.resetTime).toISOString(),
  };
  if (input.retryAfter) {
    result['Retry-After'] = String(input.retryAfter);
  }
  return result;
}

export function checkAnonymousRateLimit(input: {
  request: Request;
  pluginId: string;
  route: AnonymousRuntimeRoute & { method?: string };
  policy?: PluginAnonymousPolicy;
  now?: number;
}): AnonymousRateLimitDecision {
  const rateLimit = input.policy?.rateLimit;
  if (!rateLimit) {
    return { allowed: true, headers: {} };
  }

  const now = input.now ?? Date.now();
  const windowMs = parseWindowMs(rateLimit.window);
  const key = buildKey({ ...input, policy: rateLimit });
  const record = store.get(key);

  if (!record || record.resetTime <= now) {
    const resetTime = now + windowMs;
    store.set(key, { count: 1, resetTime });
    return {
      allowed: true,
      headers: headers({
        limit: rateLimit.limit,
        remaining: rateLimit.limit - 1,
        resetTime,
      }),
    };
  }

  if (record.count < rateLimit.limit) {
    record.count += 1;
    return {
      allowed: true,
      headers: headers({
        limit: rateLimit.limit,
        remaining: rateLimit.limit - record.count,
        resetTime: record.resetTime,
      }),
    };
  }

  const retryAfter = Math.max(1, Math.ceil((record.resetTime - now) / 1000));
  return {
    allowed: false,
    retryAfter,
    headers: headers({
      limit: rateLimit.limit,
      remaining: 0,
      resetTime: record.resetTime,
      retryAfter,
    }),
  };
}

export function createAnonymousRateLimitError(input: {
  pluginId: string;
  routePath: string;
  retryAfter?: number;
}): PluginError {
  return new PluginError({
    code: 'PLUGIN_ANONYMOUS_RATE_LIMITED',
    message: 'Anonymous public route rate limit exceeded.',
    statusCode: 429,
    fix: 'Wait before retrying this endpoint or sign in.',
    details: {
      pluginId: input.pluginId,
      routePath: input.routePath,
      retryAfter: input.retryAfter,
    },
  });
}

export function clearAnonymousRateLimitStore(): void {
  store.clear();
}
