/**
 * CSRF Guard Middleware Tests
 *
 * Covers:
 * - Safe methods bypass
 * - Machine auth bypass
 * - X-Requested-With header allows
 * - X-CSRF-Token header allows
 * - JSON content-type allows
 * - Missing CSRF signal blocks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { withCsrfGuard } from '../csrf-guard';

function createMockRequest(
  method: string,
  options: {
    authorization?: string;
    xRequestedWith?: string;
    xCsrfToken?: string;
    contentType?: string;
  } = {}
): NextRequest {
  const headersMap: Record<string, string> = {};

  if (options.authorization) {
    headersMap['authorization'] = options.authorization;
  }
  if (options.xRequestedWith) {
    headersMap['x-requested-with'] = options.xRequestedWith;
  }
  if (options.xCsrfToken) {
    headersMap['x-csrf-token'] = options.xCsrfToken;
  }
  if (options.contentType) {
    headersMap['content-type'] = options.contentType;
  }

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

describe('CSRF Guard Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should allow safe methods without CSRF check', async () => {
    const handler = withCsrfGuard(mockHandler);

    const getRequest = createMockRequest('GET');
    const response = await handler(getRequest, { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
    expect(mockHandler).toHaveBeenCalled();
  });

  it('should allow machine auth bypass', async () => {
    const handler = withCsrfGuard(mockHandler);

    const request = createMockRequest('POST', {
      authorization: 'Bearer token123',
    });
    const response = await handler(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
  });

  it('should allow X-Requested-With header', async () => {
    const handler = withCsrfGuard(mockHandler);

    const request = createMockRequest('POST', {
      xRequestedWith: 'XMLHttpRequest',
    });
    const response = await handler(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
  });

  it('should allow X-CSRF-Token header', async () => {
    const handler = withCsrfGuard(mockHandler);

    const request = createMockRequest('POST', {
      xCsrfToken: 'some-token',
    });
    const response = await handler(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
  });

  it('should allow application/json content type', async () => {
    const handler = withCsrfGuard(mockHandler);

    const request = createMockRequest('POST', {
      contentType: 'application/json',
    });
    const response = await handler(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
  });

  it('should block requests without CSRF signal', async () => {
    const handler = withCsrfGuard(mockHandler);

    const request = createMockRequest('POST');
    const response = await handler(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.code).toBe('CSRF_GUARD_DENIED');
  });

  it('should block with plain text content type', async () => {
    const handler = withCsrfGuard(mockHandler);

    const request = createMockRequest('POST', {
      contentType: 'text/plain',
    });
    const response = await handler(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(403);
  });

  it('should allow PUT/PATCH/DELETE with CSRF signal', async () => {
    const handler = withCsrfGuard(mockHandler);

    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const request = createMockRequest(method as any, {
        xRequestedWith: 'XMLHttpRequest',
      });
      const response = await handler(request, { params: Promise.resolve({}) });
      expect(response.status).toBe(200);
    }
  });
});
