/**
 * Origin Guard Middleware Tests
 *
 * Covers:
 * - Safe methods bypass
 * - Machine auth bypass
 * - Valid origin allows
 * - Invalid origin blocks
 * - Referer fallback
 * - Missing origin in production blocks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { withOriginGuard } from '../origin-guard';

// Mock env
vi.mock('@/lib/_core/env', () => ({
  env: {
    NODE_ENV: 'production',
    NEXT_PUBLIC_APP_URL: 'https://app.example.com',
    BETTER_AUTH_URL: 'https://auth.example.com',
  },
}));

function createMockRequest(
  method: string,
  options: {
    origin?: string;
    referer?: string;
    authorization?: string;
  } = {}
): NextRequest {
  const headersMap: Record<string, string> = {};

  if (options.origin) {
    headersMap['origin'] = options.origin;
  }
  if (options.referer) {
    headersMap['referer'] = options.referer;
  }
  if (options.authorization) {
    headersMap['authorization'] = options.authorization;
  }

  // NextRequest constructor strips forbidden headers like 'origin' in test env,
  // so we mock headers.get directly
  const req = new NextRequest('https://app.example.com/api/test', {
    method,
  });

  vi.spyOn(req.headers, 'get').mockImplementation((name: string) => {
    return headersMap[name.toLowerCase()] || null;
  });

  return req;
}

const mockHandler = vi.fn(
  async (_req: NextRequest, _ctx: { params: Promise<Record<string, string>> }) => {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
);

describe('Origin Guard Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should allow safe methods without origin check', async () => {
    const handler = withOriginGuard(mockHandler);

    const getRequest = createMockRequest('GET');
    const response = await handler(getRequest, { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
    expect(mockHandler).toHaveBeenCalled();
  });

  it('should allow valid origin', async () => {
    const handler = withOriginGuard(mockHandler);

    const request = createMockRequest('POST', { origin: 'https://app.example.com' });
    const response = await handler(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
  });

  it('should allow valid auth URL origin', async () => {
    const handler = withOriginGuard(mockHandler);

    const request = createMockRequest('POST', { origin: 'https://auth.example.com' });
    const response = await handler(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
  });

  it('should block invalid origin', async () => {
    const handler = withOriginGuard(mockHandler);

    const request = createMockRequest('POST', { origin: 'https://evil.com' });
    const response = await handler(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.code).toBe('ORIGIN_GUARD_DENIED');
  });

  it('should block missing origin in production', async () => {
    const handler = withOriginGuard(mockHandler);

    const request = createMockRequest('POST');
    const response = await handler(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(403);
  });

  it('should allow machine auth bypass', async () => {
    const handler = withOriginGuard(mockHandler);

    const request = createMockRequest('POST', {
      origin: 'https://evil.com',
      authorization: 'Bearer token123',
    });
    const response = await handler(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
  });

  it('should fall back to referer header', async () => {
    const handler = withOriginGuard(mockHandler);

    const request = createMockRequest('POST', {
      referer: 'https://app.example.com/page',
    });
    const response = await handler(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
  });

  it('should block invalid referer', async () => {
    const handler = withOriginGuard(mockHandler);

    const request = createMockRequest('POST', {
      referer: 'https://evil.com/page',
    });
    const response = await handler(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(403);
  });

  it('should allow PUT/PATCH/DELETE with valid origin', async () => {
    const handler = withOriginGuard(mockHandler);

    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const request = createMockRequest(method as any, { origin: 'https://app.example.com' });
      const response = await handler(request, { params: Promise.resolve({}) });
      expect(response.status).toBe(200);
    }
  });
});
