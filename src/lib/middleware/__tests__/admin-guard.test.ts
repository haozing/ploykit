import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { ERROR_CODES } from '@/lib/_core/constants';

const { getSessionMock, isAdminMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  isAdminMock: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  isAdmin: isAdminMock,
}));

vi.mock('@/lib/services/user/user-status', () => ({
  assertUserAccountActive: vi.fn().mockResolvedValue(undefined),
}));

import { withAdminGuard } from '../admin-guard';

function createRequest(): NextRequest {
  return new NextRequest('https://app.example.com/api/admin/test', {
    headers: {
      'x-request-id': 'req_admin_guard',
    },
  });
}

function mockSession(userId = 'user-1') {
  getSessionMock.mockResolvedValue({
    session: { id: 'session-1' },
    user: { id: userId, email: `${userId}@example.com` },
  });
}

describe('Admin Guard Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a structured 403 for authenticated non-admin users', async () => {
    mockSession('regular-user');
    isAdminMock.mockResolvedValue(false);
    const handler = vi.fn(async () => NextResponse.json({ success: true }));

    const response = await withAdminGuard(handler)(createRequest(), {
      params: Promise.resolve({}),
    });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(response.headers.get('x-request-id')).toBe('req_admin_guard');
    expect(payload).toMatchObject({
      success: false,
      code: ERROR_CODES.INSUFFICIENT_PERMISSIONS,
      error: {
        code: ERROR_CODES.INSUFFICIENT_PERMISSIONS,
        statusCode: 403,
      },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('runs the handler for admin users', async () => {
    mockSession('admin-user');
    isAdminMock.mockResolvedValue(true);
    const handler = vi.fn(async () => NextResponse.json({ success: true }));

    const response = await withAdminGuard(handler)(createRequest(), {
      params: Promise.resolve({}),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true });
    expect(handler).toHaveBeenCalledOnce();
  });
});
