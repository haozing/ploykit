import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createApiSecurityResponse,
  getApiSecurityDecision,
  type ApiSecurityConfig,
} from './lib/security/api-security-middleware';
import {
  createMissingStripeSignatureResponse,
  shouldRejectUnsignedStripeWebhook,
} from './lib/security/stripe-webhook-proxy-guard';

const productionConfig: ApiSecurityConfig = {
  nodeEnv: 'production',
  appUrl: 'https://app.example.com',
  authUrl: 'https://app.example.com',
};

function createRequest(
  pathname: string,
  options: { method?: string; headers?: Record<string, string> } = {}
): NextRequest {
  const request = new NextRequest(`https://app.example.com${pathname}`, {
    method: options.method || 'GET',
    headers: options.headers,
  });

  const headers = new Map(
    Object.entries(options.headers || {}).map(([key, value]) => [key.toLowerCase(), value])
  );

  vi.spyOn(request.headers, 'get').mockImplementation((name: string) => {
    return headers.get(name.toLowerCase()) || null;
  });

  return request;
}

describe('API security middleware', () => {
  it('blocks debug API routes in production', () => {
    const decision = getApiSecurityDecision(createRequest('/api/debug/slots'), productionConfig);

    expect(decision).toMatchObject({
      action: 'block',
      status: 404,
      code: 'DEBUG_ROUTE_DISABLED',
    });
  });

  it('blocks billing mock API routes in production', () => {
    const decision = getApiSecurityDecision(
      createRequest('/api/billing/products'),
      productionConfig
    );

    expect(decision).toMatchObject({
      action: 'block',
      status: 404,
      code: 'MOCK_ROUTE_DISABLED',
    });
  });

  it('allows real billing API routes in production', () => {
    const decision = getApiSecurityDecision(createRequest('/api/billing/portal'), productionConfig);

    expect(decision).toEqual({ action: 'allow' });
  });

  it('allows safe methods without mutation checks', () => {
    const decision = getApiSecurityDecision(createRequest('/api/plans'), productionConfig);

    expect(decision).toEqual({ action: 'allow' });
  });

  it('blocks state-changing API requests from invalid origins', () => {
    const decision = getApiSecurityDecision(
      createRequest('/api/contact', {
        method: 'POST',
        headers: {
          origin: 'https://evil.example.com',
          'content-type': 'application/json',
        },
      }),
      productionConfig
    );

    expect(decision).toMatchObject({
      action: 'block',
      status: 403,
      code: 'ORIGIN_GUARD_DENIED',
    });
  });

  it('allows same-origin JSON mutations', () => {
    const decision = getApiSecurityDecision(
      createRequest('/api/contact', {
        method: 'POST',
        headers: {
          referer: 'https://app.example.com/pricing',
          'content-type': 'application/json',
        },
      }),
      productionConfig
    );

    expect(decision).toEqual({ action: 'allow' });
  });

  it('exempts signed webhook routes from browser mutation guards', () => {
    const decision = getApiSecurityDecision(
      createRequest('/api/webhooks/stripe', { method: 'POST' }),
      productionConfig
    );

    expect(decision).toEqual({ action: 'allow' });
  });

  it('exempts signed plugin file upload routes from browser mutation guards', () => {
    const decision = getApiSecurityDecision(
      createRequest('/api/plugin-files/file-1/upload', { method: 'PUT' }),
      productionConfig
    );

    expect(decision).toEqual({ action: 'allow' });
  });

  it('formats blocked API security responses with structured error payloads', async () => {
    const response = createApiSecurityResponse(
      {
        action: 'block',
        status: 403,
        code: 'CSRF_GUARD_DENIED',
        message: 'CSRF validation failed',
      },
      'req_test'
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({
      success: false,
      code: 'CSRF_GUARD_DENIED',
      requestId: 'req_test',
      error: {
        code: 'CSRF_GUARD_DENIED',
        message: 'CSRF validation failed',
        statusCode: 403,
      },
    });
  });
});

describe('API proxy webhook validation', () => {
  it('rejects unsigned Stripe webhook POSTs before route execution', async () => {
    const request = createRequest('/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
    });
    const response = createMissingStripeSignatureResponse('req_test');

    expect(shouldRejectUnsignedStripeWebhook(request)).toBe(true);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VAL_001',
      error: {
        message: 'Missing stripe-signature header',
        statusCode: 400,
      },
    });
    expect(response.status).toBe(400);
  });
});
