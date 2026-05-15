import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import {
  clearApiRateLimitStore,
  createApiRateLimitResponse,
  getApiRateLimitDecision,
} from '../api-rate-limit-middleware';

function createRequest(
  pathname: string,
  options: { method?: string; headers?: Record<string, string> } = {}
): NextRequest {
  return new NextRequest(`https://app.example.com${pathname}`, {
    method: options.method || 'GET',
    headers: {
      'x-forwarded-for': '203.0.113.24',
      ...options.headers,
    },
  });
}

describe('API rate limit middleware', () => {
  beforeEach(() => {
    clearApiRateLimitStore();
  });

  afterEach(() => {
    clearApiRateLimitStore();
    delete process.env.PLOYKIT_API_RATE_LIMIT_MULTIPLIER;
  });

  it('does not rate limit routes outside the critical API set', () => {
    const decision = getApiRateLimitDecision(createRequest('/api/plans'));

    expect(decision).toEqual({ action: 'allow' });
  });

  it('blocks auth mutations after the policy limit is reached', () => {
    const now = new Date('2026-05-07T00:00:00Z').getTime();
    const request = createRequest('/api/auth/sign-in/email', { method: 'POST' });

    for (let index = 0; index < 30; index += 1) {
      const decision = getApiRateLimitDecision(request, now);
      expect(decision.action).toBe('allow');
    }

    const blocked = getApiRateLimitDecision(request, now);

    expect(blocked).toMatchObject({
      action: 'block',
      status: 429,
      code: 'RATE_LIMITED',
    });
  });

  it('tracks plugin API routes by method and path', () => {
    const now = new Date('2026-05-07T00:00:00Z').getTime();
    const postRequest = createRequest('/api/plugins/demo/tasks', { method: 'POST' });
    const getRequest = createRequest('/api/plugins/demo/tasks', { method: 'GET' });

    const postDecision = getApiRateLimitDecision(postRequest, now);
    const getDecision = getApiRateLimitDecision(getRequest, now);

    expect(postDecision.action).toBe('allow');
    expect(getDecision.action).toBe('allow');
    expect(postDecision.headers?.['X-RateLimit-Remaining']).toBe('119');
    expect(getDecision.headers?.['X-RateLimit-Remaining']).toBe('119');
  });

  it('can raise policy limits for high-volume local browser tests', () => {
    process.env.PLOYKIT_API_RATE_LIMIT_MULTIPLIER = '2';

    const now = new Date('2026-05-07T00:00:00Z').getTime();
    const request = createRequest('/api/auth/get-session');
    const decision = getApiRateLimitDecision(request, now);

    expect(decision.action).toBe('allow');
    expect(decision.headers?.['X-RateLimit-Limit']).toBe('240');
    expect(decision.headers?.['X-RateLimit-Remaining']).toBe('239');
  });

  it('uses a high signed webhook limit and a stricter unsigned limit', () => {
    const now = new Date('2026-05-07T00:00:00Z').getTime();
    const signed = getApiRateLimitDecision(
      createRequest('/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 't=123,v1=abcdef' },
      }),
      now
    );
    const unsigned = getApiRateLimitDecision(
      createRequest('/api/webhooks/stripe', { method: 'POST' }),
      now
    );

    expect(signed.headers?.['X-RateLimit-Limit']).toBe('600');
    expect(unsigned.headers?.['X-RateLimit-Limit']).toBe('30');
  });

  it('treats plugin webhook routes as webhook traffic instead of plugin API traffic', () => {
    const now = new Date('2026-05-07T00:00:00Z').getTime();
    const decision = getApiRateLimitDecision(
      createRequest('/api/plugins/demo/webhooks/ingest', {
        method: 'POST',
        headers: { 'x-ploykit-signature': 'sha256=abcdef' },
      }),
      now
    );

    if (decision.action !== 'allow') {
      throw new Error('First plugin webhook request should be allowed');
    }

    expect(decision.policyId).toBe('webhook-signed');
    expect(decision.headers?.['X-RateLimit-Limit']).toBe('600');
  });

  it('returns structured rate-limit errors', async () => {
    const blocked = getApiRateLimitDecision(
      createRequest('/api/contact', { method: 'POST' }),
      new Date('2026-05-07T00:00:00Z').getTime()
    );

    if (blocked.action !== 'allow') {
      throw new Error('First contact request should be allowed');
    }

    const response = createApiRateLimitResponse(
      {
        action: 'block',
        status: 429,
        code: 'RATE_LIMITED',
        message: 'Too many requests.',
        retryAfter: 10,
        headers: { 'Retry-After': '10' },
      },
      'req_test'
    );
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload.error).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Too many requests.',
      retryAfter: 10,
    });
    expect(payload.requestId).toBe('req_test');
  });
});
