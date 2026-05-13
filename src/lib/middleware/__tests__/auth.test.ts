import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { getSessionMock, requireUserContextMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  requireUserContextMock: vi.fn(async (_userId, callback) => callback({})),
}));

vi.mock('@/lib/auth/server', () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock('@/lib/db', () => ({
  requireUserContext: requireUserContextMock,
}));

vi.mock('@/lib/services/user/user-status', () => ({
  assertUserAccountActive: vi.fn().mockResolvedValue(undefined),
}));

import { withAuth, withAuthenticatedUserContext } from '../auth';

function createRequest(): NextRequest {
  return new NextRequest('https://app.example.com/api/test');
}

describe('auth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserContextMock.mockImplementation(async (_userId, callback) => callback({}));
  });

  it('injects authenticated user context', async () => {
    getSessionMock.mockResolvedValue({
      session: { id: 'session_1' },
      user: { id: 'user_1', email: 'user@example.com' },
    });
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));

    const response = await withAuth(handler)(createRequest(), { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        auth: {
          session: { id: 'session_1' },
          userId: 'user_1',
          userEmail: 'user@example.com',
        },
      })
    );
  });

  it('wraps handlers with the authenticated DB user context', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const request = createRequest();
    const context = {
      params: Promise.resolve({}),
      auth: {
        session: { id: 'session_1' } as never,
        userId: 'user_1',
        userEmail: 'user@example.com',
      },
    };

    const response = await withAuthenticatedUserContext(handler)(request, context);

    expect(response.status).toBe(200);
    expect(requireUserContextMock).toHaveBeenCalledWith('user_1', expect.any(Function));
    expect(handler).toHaveBeenCalledWith(request, context);
  });
});
