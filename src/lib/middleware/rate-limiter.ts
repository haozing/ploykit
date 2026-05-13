/**
 * Rate Limiter Middleware
 *
 * Provides API rate limiting based on:
 * - Plan limits (different rates per plan)
 * - User-specific limits (global system)
 * - IP-based limiting
 * - Endpoint-specific limits
 *
 * Uses in-memory storage (can be replaced with Redis for production)
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/server';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  message?: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

// In-memory store (use Redis in production)
const rateLimitStore: RateLimitStore = {};

// Cleanup old entries every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    Object.keys(rateLimitStore).forEach((key) => {
      if (rateLimitStore[key].resetTime < now) {
        delete rateLimitStore[key];
      }
    });
  },
  5 * 60 * 1000
);

/**
 * Get rate limit configuration based on plan
 */
function _getRateLimitForPlan(planId: string): RateLimitConfig {
  // Default rate limits per plan
  const planLimits: Record<string, RateLimitConfig> = {
    'free-plan': {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 10,
      message: 'Free plan rate limit exceeded. Upgrade for higher limits.',
    },
    'basic-plan': {
      windowMs: 60 * 1000,
      maxRequests: 60,
      message: 'Basic plan rate limit exceeded.',
    },
    'pro-plan': {
      windowMs: 60 * 1000,
      maxRequests: 300,
      message: 'Pro plan rate limit exceeded.',
    },
    'enterprise-plan': {
      windowMs: 60 * 1000,
      maxRequests: 1000,
      message: 'Enterprise plan rate limit exceeded.',
    },
  };

  return (
    planLimits[planId] || {
      windowMs: 60 * 1000,
      maxRequests: 30,
      message: 'Rate limit exceeded.',
    }
  );
}

/**
 * Generate rate limit key
 */
function generateKey(userId: string, ip: string, endpoint?: string): string {
  const parts = ['ratelimit', userId, ip];
  if (endpoint) parts.push(endpoint);
  return parts.join(':');
}

/**
 * Check rate limit
 */
function checkRateLimit(
  key: string,
  config: RateLimitConfig
): {
  allowed: boolean;
  remaining: number;
  resetTime: number;
} {
  const now = Date.now();
  const record = rateLimitStore[key];

  // No record or expired window
  if (!record || record.resetTime < now) {
    rateLimitStore[key] = {
      count: 1,
      resetTime: now + config.windowMs,
    };

    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetTime: now + config.windowMs,
    };
  }

  // Within window
  if (record.count < config.maxRequests) {
    record.count++;
    return {
      allowed: true,
      remaining: config.maxRequests - record.count,
      resetTime: record.resetTime,
    };
  }

  // Rate limit exceeded
  return {
    allowed: false,
    remaining: 0,
    resetTime: record.resetTime,
  };
}

/**
 * Rate limiter middleware factory
 */
export function createRateLimiter(options?: Partial<RateLimitConfig>) {
  const defaultConfig: RateLimitConfig = {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 60,
    message: 'Too many requests, please try again later.',
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
    ...options,
  };

  return async function rateLimiterMiddleware(
    request: NextRequest,
    handler: () => Promise<NextResponse>
  ): Promise<NextResponse> {
    const headers = new Headers();

    try {
      // Extract user ID from authenticated session (global system)
      let userId = 'anonymous';
      try {
        const session = await auth.api.getSession({ headers: request.headers });
        if (session?.user?.id) {
          userId = session.user.id;
        }
      } catch {
        // Anonymous request - use default limits
      }

      // Get client IP
      const ip =
        request.headers.get('x-forwarded-for')?.split(',')[0] ||
        request.headers.get('x-real-ip') ||
        'unknown';

      // Get endpoint
      const endpoint = request.nextUrl.pathname;

      // Get rate limit config based on user's plan
      const config = defaultConfig;

      if (userId !== 'anonymous') {
        // TODO: Implement user subscription service to get plan-based limits
        // For now, use default config for all authenticated users
        // Future: Get user's subscription and apply plan-specific limits
        // const subscription = await getUserSubscription(userId);
        // if (subscription) {
        //   config = getRateLimitForPlan(subscription.planId);
        // }
      }

      // Generate rate limit key
      const key = generateKey(userId, ip, endpoint);

      // Check rate limit
      const { allowed, remaining, resetTime } = checkRateLimit(key, config);

      // Add rate limit headers
      headers.set('X-RateLimit-Limit', config.maxRequests.toString());
      headers.set('X-RateLimit-Remaining', remaining.toString());
      headers.set('X-RateLimit-Reset', new Date(resetTime).toISOString());

      if (!allowed) {
        // Rate limit exceeded
        return new NextResponse(
          JSON.stringify({
            success: false,
            error: config.message,
            retryAfter: Math.ceil((resetTime - Date.now()) / 1000),
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': Math.ceil((resetTime - Date.now()) / 1000).toString(),
              ...Object.fromEntries(headers.entries()),
            },
          }
        );
      }
    } catch (error) {
      console.error('Error in rate limiter middleware:', error);
      // Continue with request if rate limiter fails
      return handler();
    }

    // Execute handler outside the limiter fallback. Application errors must
    // propagate to the route error handler instead of retrying the same body.
    const response = await handler();

    // Add rate limit headers to response
    headers.forEach((value, key) => {
      response.headers.set(key, value);
    });

    return response;
  };
}

/**
 * Endpoint-specific rate limiters
 */
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5,
  message: 'Too many authentication attempts, please try again later.',
});

export const apiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 60,
  message: 'API rate limit exceeded.',
});

export const strictRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 10,
  message: 'Rate limit exceeded for this endpoint.',
});

/**
 * Apply rate limiter to API route handler
 */
export function withRateLimit(
  handler: (
    request: NextRequest,
    context: { params: Promise<Record<string, string>> }
  ) => Promise<Response>,
  limiter = apiRateLimiter
) {
  return async (
    request: NextRequest,
    context: { params: Promise<Record<string, string>> }
  ): Promise<Response> => {
    return limiter(request, () => handler(request, context) as Promise<NextResponse>);
  };
}

/**
 * Get current rate limit status for a key
 */
export function getRateLimitStatus(
  userId: string,
  ip: string,
  endpoint?: string
): {
  count: number;
  limit: number;
  remaining: number;
  resetTime: number;
} | null {
  const key = generateKey(userId, ip, endpoint);
  const record = rateLimitStore[key];

  if (!record) {
    return null;
  }

  // Estimate limit based on common plans (this is simplified)
  const limit = 60; // Default

  return {
    count: record.count,
    limit,
    remaining: Math.max(0, limit - record.count),
    resetTime: record.resetTime,
  };
}

/**
 * Reset rate limit for a key (admin function)
 */
export function resetRateLimit(userId: string, ip: string, endpoint?: string): void {
  const key = generateKey(userId, ip, endpoint);
  delete rateLimitStore[key];
}

/**
 * Clear all rate limits (admin function)
 */
export function clearAllRateLimits(): void {
  Object.keys(rateLimitStore).forEach((key) => {
    delete rateLimitStore[key];
  });
}
