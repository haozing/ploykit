import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { intlMiddlewareMock } = vi.hoisted(() => ({
  intlMiddlewareMock: vi.fn((request: NextRequest) => {
    const response = NextResponse.next({
      request: {
        headers: request.headers,
      },
    });
    response.headers.set('x-intl-seen-pathname', request.headers.get('x-pathname') ?? '');
    return response;
  }),
}));

vi.mock('next-intl/middleware', () => ({
  default: vi.fn(() => intlMiddlewareMock),
}));

vi.mock('./lib/security/api-security-middleware', () => ({
  createApiSecurityResponse: vi.fn(),
  getApiSecurityDecision: vi.fn(() => ({ action: 'allow' })),
}));

vi.mock('./lib/security/api-rate-limit-middleware', () => ({
  applyApiRateLimitHeaders: vi.fn(),
  createApiRateLimitResponse: vi.fn(),
  getApiRateLimitDecision: vi.fn(() => ({ action: 'allow' })),
}));

vi.mock('./lib/security/security-headers', () => ({
  applySecurityHeaders: vi.fn((response) => response),
}));

import { proxy } from './proxy';

describe('proxy request metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the original pathname as a downstream request header', () => {
    const request = new NextRequest('https://app.example.com/zh/profile?tab=account', {
      headers: {
        'x-request-id': 'req_1',
      },
    });

    const response = proxy(request);

    expect(intlMiddlewareMock).toHaveBeenCalledTimes(1);
    const forwardedRequest = intlMiddlewareMock.mock.calls[0][0];
    expect(forwardedRequest.headers.get('x-pathname')).toBe('/zh/profile');
    expect(forwardedRequest.headers.get('x-url')).toBe(
      'https://app.example.com/zh/profile?tab=account'
    );
    expect(forwardedRequest.headers.get('x-request-id')).toBe('req_1');
    expect(response.headers.get('x-intl-seen-pathname')).toBe('/zh/profile');
    expect(response.headers.get('x-pathname')).toBe('/zh/profile');
  });

  it('does not locale-redirect metadata image routes', () => {
    const request = new NextRequest('https://app.example.com/opengraph-image', {
      headers: {
        'x-request-id': 'req_og',
      },
    });

    const response = proxy(request);

    expect(intlMiddlewareMock).not.toHaveBeenCalled();
    expect(response.headers.get('x-request-id')).toBe('req_og');
    expect(response.headers.get('x-pathname')).toBe('/opengraph-image');
  });
});
