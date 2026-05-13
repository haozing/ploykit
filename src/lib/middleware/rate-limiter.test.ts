/**
 * Unit Tests for Rate Limiter Middleware
 *
 * Tests cover:
 * - Rate limiting by plan (user-based)
 * - Request counting and window expiration
 * - Rate limit headers
 * - Plan-based limits
 * - Endpoint-specific limiting
 * - Admin functions (reset, clear)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { timeUtils } from '@/lib/test-utils/test-helpers';

// Mock Better Auth
vi.mock('@/lib/auth/server', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

import { auth } from '@/lib/auth/server';
import {
  createRateLimiter,
  withRateLimit,
  authRateLimiter,
  apiRateLimiter,
  strictRateLimiter,
  getRateLimitStatus,
  resetRateLimit,
  clearAllRateLimits,
} from './rate-limiter';

// Helper to create mock request
function createMockRequest(
  options: {
    url?: string;
    userId?: string;
    ip?: string;
    headers?: Record<string, string>;
  } = {}
): NextRequest {
  const {
    url = 'http://localhost:3000/api/test',
    userId,
    ip = '127.0.0.1',
    headers = {},
  } = options;

  const allHeaders: Record<string, string> = {
    ...headers,
  };

  if (ip) {
    allHeaders['x-forwarded-for'] = ip;
  }

  const request = new NextRequest(url, {
    headers: allHeaders,
  });

  // Mock auth session based on userId
  if (userId) {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      session: {
        id: 'session-123',
        userId,
        token: 'mock-token',
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ipAddress: null,
        userAgent: null,
      },
      user: {
        id: userId,
        email: `user-${userId}@test.com`,
        name: 'Test User',
        emailVerified: false,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  } else {
    // Anonymous - no session
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
  }

  return request;
}

// Helper to create mock handler
function createMockHandler(
  responseData: Record<string, unknown> = { success: true }
): () => Promise<NextResponse> {
  return vi.fn(async () => {
    return NextResponse.json(responseData);
  });
}

describe('Rate Limiter Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllRateLimits();
    timeUtils.freezeTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    clearAllRateLimits();
    timeUtils.unfreezeTime();
  });

  describe('createRateLimiter', () => {
    it('should allow requests under limit', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
      });

      const request = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const handler = createMockHandler();

      const response = await limiter(request, handler);

      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalled();
      expect(response.headers.get('X-RateLimit-Limit')).toBe('10');
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('9');
      expect(response.headers.get('X-RateLimit-Reset')).toBeTruthy();
    });

    it('should block requests over limit', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 3,
      });

      const request1 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const request2 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const request3 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const request4 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const handler = createMockHandler();

      // Make 3 requests (should all pass)
      await limiter(request1, handler);
      await limiter(request2, handler);
      await limiter(request3, handler);

      // 4th request should be blocked
      const response = await limiter(request4, handler);

      expect(response.status).toBe(429);
      expect(handler).toHaveBeenCalledTimes(3); // Only called 3 times
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
      expect(response.headers.get('Retry-After')).toBeTruthy();

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Too many requests');
    });

    it('should reset counter after window expires', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000, // 1 minute
        maxRequests: 2,
      });

      const request1 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const request2 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const request3 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const request4 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const handler = createMockHandler();

      // Use up the limit
      await limiter(request1, handler);
      await limiter(request2, handler);

      // 3rd request should be blocked
      let response = await limiter(request3, handler);
      expect(response.status).toBe(429);

      // Advance time past window
      timeUtils.advanceTime(61000);

      // Should allow request after window expires
      response = await limiter(request4, handler);
      expect(response.status).toBe(200);
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('1');
    });

    it('should track different users separately', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 2,
      });

      const user1Request1 = createMockRequest({ userId: 'user-1', ip: '127.0.0.1' });
      const user1Request2 = createMockRequest({ userId: 'user-1', ip: '127.0.0.1' });
      const user1Request3 = createMockRequest({ userId: 'user-1', ip: '127.0.0.1' });
      const user2Request = createMockRequest({ userId: 'user-2', ip: '127.0.0.1' });
      const handler = createMockHandler();

      // Use up limit for user-1
      await limiter(user1Request1, handler);
      await limiter(user1Request2, handler);

      // user-1 should be blocked
      let response = await limiter(user1Request3, handler);
      expect(response.status).toBe(429);

      // user-2 should still work
      response = await limiter(user2Request, handler);
      expect(response.status).toBe(200);
    });

    it('should track different IPs separately', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 2,
      });

      const ip1Request1 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const ip1Request2 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const ip1Request3 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const ip2Request = createMockRequest({ userId: 'user-123', ip: '192.168.1.1' });
      const handler = createMockHandler();

      // Use up limit for IP1
      await limiter(ip1Request1, handler);
      await limiter(ip1Request2, handler);

      // IP1 should be blocked
      let response = await limiter(ip1Request3, handler);
      expect(response.status).toBe(429);

      // IP2 should still work
      response = await limiter(ip2Request, handler);
      expect(response.status).toBe(200);
    });

    it('should handle anonymous users', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 5,
      });

      const request = createMockRequest({ ip: '127.0.0.1' }); // No userId
      const handler = createMockHandler();

      const response = await limiter(request, handler);

      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalled();
    });

    it('should use custom error message', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        message: 'Custom error message',
      });

      const request1 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const request2 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const handler = createMockHandler();

      await limiter(request1, handler);
      const response = await limiter(request2, handler);

      const data = await response.json();
      expect(data.error).toBe('Custom error message');
    });
  });

  // TODO: Add plan-based rate limiting tests when user subscription service is implemented
  // describe('Plan-based Rate Limiting', () => { ... });

  describe('Specialized Rate Limiters', () => {
    it('authRateLimiter should have strict limits', async () => {
      const requests = Array.from({ length: 6 }, () =>
        createMockRequest({ userId: 'user-123', ip: '127.0.0.1' })
      );
      const handler = createMockHandler();

      // Auth limiter allows 5 requests per 15 minutes
      for (let i = 0; i < 5; i++) {
        const response = await authRateLimiter(requests[i], handler);
        expect(response.status).toBe(200);
      }

      // 6th request should be blocked
      const response = await authRateLimiter(requests[5], handler);
      expect(response.status).toBe(429);

      const data = await response.json();
      expect(data.error).toContain('authentication attempts');
    });

    it('apiRateLimiter should have moderate limits', async () => {
      const request = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const handler = createMockHandler();

      const response = await apiRateLimiter(request, handler);
      expect(response.status).toBe(200);
      expect(response.headers.get('X-RateLimit-Limit')).toBe('60');
    });

    it('strictRateLimiter should have tight limits', async () => {
      const request = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const handler = createMockHandler();

      const response = await strictRateLimiter(request, handler);
      expect(response.status).toBe(200);
      expect(response.headers.get('X-RateLimit-Limit')).toBe('10');
    });
  });

  describe('withRateLimit wrapper', () => {
    it('should wrap handler with rate limiting', async () => {
      const handler = vi.fn(async (_req: NextRequest) => {
        return NextResponse.json({ data: 'test' });
      });

      const limiter = createRateLimiter({
        maxRequests: 2,
      });

      const wrappedHandler = withRateLimit(handler, limiter);

      const request1 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const request2 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const request3 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });

      const mockContext = { params: Promise.resolve({}) };

      // First 2 requests should pass
      await wrappedHandler(request1, mockContext);
      await wrappedHandler(request2, mockContext);

      // 3rd should be blocked
      const response = await wrappedHandler(request3, mockContext);
      expect(response.status).toBe(429);
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('Admin Functions', () => {
    it('getRateLimitStatus should return current status', async () => {
      const limiter = createRateLimiter({
        maxRequests: 10,
      });

      const request1 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const request2 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const request3 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const handler = createMockHandler();

      // No status before first request
      let status = getRateLimitStatus('user-123', '127.0.0.1', '/api/test');
      expect(status).toBeNull();

      // Make 3 requests
      await limiter(request1, handler);
      await limiter(request2, handler);
      await limiter(request3, handler);

      // Check status
      status = getRateLimitStatus('user-123', '127.0.0.1', '/api/test');
      expect(status).toBeDefined();
      expect(status!.count).toBe(3);
      expect(status!.resetTime).toBeTruthy();
    });

    it('resetRateLimit should clear limit for specific key', async () => {
      const limiter = createRateLimiter({
        maxRequests: 2,
      });

      const request1 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const request2 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const request3 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const request4 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const handler = createMockHandler();

      // Use up limit
      await limiter(request1, handler);
      await limiter(request2, handler);

      // Should be blocked
      let response = await limiter(request3, handler);
      expect(response.status).toBe(429);

      // Reset limit
      resetRateLimit('user-123', '127.0.0.1', '/api/test');

      // Should work again
      response = await limiter(request4, handler);
      expect(response.status).toBe(200);
    });

    it('clearAllRateLimits should clear all limits', async () => {
      const limiter = createRateLimiter({
        maxRequests: 1,
      });

      const handler = createMockHandler();

      // Use up limits for both users
      const user1Request1 = createMockRequest({ userId: 'user-1', ip: '127.0.0.1' });
      await limiter(user1Request1, handler);

      const user2Request1 = createMockRequest({ userId: 'user-2', ip: '192.168.1.1' });
      await limiter(user2Request1, handler);

      // Both should be blocked now
      const user1Request2 = createMockRequest({ userId: 'user-1', ip: '127.0.0.1' });
      let response1 = await limiter(user1Request2, handler);
      expect(response1.status).toBe(429);

      const user2Request2 = createMockRequest({ userId: 'user-2', ip: '192.168.1.1' });
      let response2 = await limiter(user2Request2, handler);
      expect(response2.status).toBe(429);

      // Clear all limits
      clearAllRateLimits();

      // Both should work again
      const user1Request3 = createMockRequest({ userId: 'user-1', ip: '127.0.0.1' });
      response1 = await limiter(user1Request3, handler);
      expect(response1.status).toBe(200);

      const user2Request3 = createMockRequest({ userId: 'user-2', ip: '192.168.1.1' });
      response2 = await limiter(user2Request3, handler);
      expect(response2.status).toBe(200);
    });
  });

  describe('Error Handling', () => {
    it('should continue if auth session retrieval fails', async () => {
      const limiter = createRateLimiter();

      // Mock auth to throw
      vi.mocked(auth.api.getSession).mockRejectedValueOnce(new Error('Auth error'));

      const request = createMockRequest({ ip: '127.0.0.1' });
      const handler = createMockHandler();

      // Should still call handler even if auth fails (treats as anonymous)
      const response = await limiter(request, handler);
      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalled();
    });

    it('should not retry the handler when application logic fails', async () => {
      const limiter = createRateLimiter();
      const request = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const handler = vi.fn(async () => {
        throw new Error('Application error');
      });

      await expect(limiter(request, handler)).rejects.toThrow('Application error');
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Rate Limit Headers', () => {
    it('should include all required headers', async () => {
      const limiter = createRateLimiter({
        maxRequests: 10,
      });

      const request = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const handler = createMockHandler();

      const response = await limiter(request, handler);

      expect(response.headers.get('X-RateLimit-Limit')).toBe('10');
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('9');
      expect(response.headers.get('X-RateLimit-Reset')).toMatch(/^\d{4}-\d{2}-\d{2}/);
    });

    it('should include Retry-After header when blocked', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
      });

      const request1 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const request2 = createMockRequest({ userId: 'user-123', ip: '127.0.0.1' });
      const handler = createMockHandler();

      await limiter(request1, handler);
      const response = await limiter(request2, handler);

      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBeTruthy();

      const retryAfter = parseInt(response.headers.get('Retry-After')!);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });
  });
});
