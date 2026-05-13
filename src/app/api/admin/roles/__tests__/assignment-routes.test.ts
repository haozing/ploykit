import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ERROR_CODES } from '@/lib/_core/constants';

const {
  assignRoleToUserMock,
  getClientIPMock,
  getSessionMock,
  isAdminMock,
  revokeRoleFromUserMock,
} = vi.hoisted(() => ({
  assignRoleToUserMock: vi.fn(),
  getClientIPMock: vi.fn(),
  getSessionMock: vi.fn(),
  isAdminMock: vi.fn(),
  revokeRoleFromUserMock: vi.fn(),
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

vi.mock('@/lib/services/rbac/role-service', () => ({
  assignRoleToUser: assignRoleToUserMock,
  revokeRoleFromUser: revokeRoleFromUserMock,
}));

vi.mock('@/lib/shared/api-helpers', () => ({
  getClientIP: getClientIPMock,
}));

vi.mock('@/lib/services/user/user-status', () => ({
  assertUserAccountActive: vi.fn().mockResolvedValue(undefined),
}));

import { POST as assignRole } from '../[id]/assign/route';
import { POST as revokeRole } from '../[id]/revoke/route';

const ROLE_ID = '650e8400-e29b-41d4-a716-446655440001';
const TEXT_USER_ID = 'admin_1761723042830';

function createRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`https://app.example.com${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'req_role_assignment',
    },
    body: JSON.stringify(body),
  });
}

function routeContext() {
  return {
    params: Promise.resolve({ id: ROLE_ID }),
  };
}

describe('admin role assignment routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientIPMock.mockReturnValue('127.0.0.1');
    getSessionMock.mockResolvedValue({
      session: { id: 'session_1' },
      user: { id: 'admin_1', email: 'admin@example.com' },
    });
    isAdminMock.mockResolvedValue(true);
    assignRoleToUserMock.mockResolvedValue({ id: 'assignment_1' });
  });

  it('assigns a role to a Better Auth text user id', async () => {
    const response = await assignRole(
      createRequest(`/api/admin/roles/${ROLE_ID}/assign`, {
        userId: TEXT_USER_ID,
      }),
      routeContext()
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual({ id: 'assignment_1' });
    expect(assignRoleToUserMock).toHaveBeenCalledWith(
      TEXT_USER_ID,
      ROLE_ID,
      'admin_1',
      '127.0.0.1',
      undefined
    );
  });

  it('rejects an empty user id before assigning a role', async () => {
    const response = await assignRole(
      createRequest(`/api/admin/roles/${ROLE_ID}/assign`, {
        userId: '',
      }),
      routeContext()
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      success: false,
      code: ERROR_CODES.INVALID_INPUT,
    });
    expect(assignRoleToUserMock).not.toHaveBeenCalled();
  });

  it('revokes a role from a Better Auth text user id', async () => {
    const response = await revokeRole(
      createRequest(`/api/admin/roles/${ROLE_ID}/revoke`, {
        userId: TEXT_USER_ID,
      }),
      routeContext()
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      success: true,
      message: 'Role revoked successfully',
    });
    expect(revokeRoleFromUserMock).toHaveBeenCalledWith(
      TEXT_USER_ID,
      ROLE_ID,
      'admin_1',
      '127.0.0.1'
    );
  });

  it('rejects an empty user id before revoking a role', async () => {
    const response = await revokeRole(
      createRequest(`/api/admin/roles/${ROLE_ID}/revoke`, {
        userId: '',
      }),
      routeContext()
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      success: false,
      code: ERROR_CODES.INVALID_INPUT,
    });
    expect(revokeRoleFromUserMock).not.toHaveBeenCalled();
  });
});
