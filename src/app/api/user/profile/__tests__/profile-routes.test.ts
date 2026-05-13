import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getSessionMock,
  hashPasswordMock,
  insertValuesMocks,
  mockDb,
  requireUserContextMock,
  updateSetMocks,
  verifyPasswordMock,
} = vi.hoisted(() => {
  const updateSetMocks: Array<ReturnType<typeof vi.fn>> = [];
  const insertValuesMocks: unknown[] = [];

  const mockDb = {
    query: {
      user: {
        findFirst: vi.fn(),
      },
      userProfiles: {
        findFirst: vi.fn(),
      },
      account: {
        findFirst: vi.fn(),
      },
    },
    update: vi.fn(() => {
      const where = vi.fn().mockResolvedValue(undefined);
      const set = vi.fn(() => ({ where }));
      updateSetMocks.push(set);
      return { set };
    }),
    insert: vi.fn(() => ({
      values: vi.fn((values) => Promise.resolve(values)),
    })),
  };

  return {
    getSessionMock: vi.fn(),
    hashPasswordMock: vi.fn(),
    mockDb,
    requireUserContextMock: vi.fn((userId, callback) => callback(mockDb)),
    insertValuesMocks,
    updateSetMocks,
    verifyPasswordMock: vi.fn(),
  };
});

vi.mock('@/lib/auth/server', () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock('@/lib/db', () => ({
  requireUserContext: requireUserContextMock,
  withSystemContext: vi.fn((callback) =>
    callback({
      query: {
        userProfiles: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
    })
  ),
}));

vi.mock('better-auth/crypto', () => ({
  hashPassword: hashPasswordMock,
  verifyPassword: verifyPasswordMock,
}));

import { GET as getPasswordCapability, POST as changePassword } from '../password/route';
import { PUT as updatePreferences } from '../preferences/route';
import { PUT as updateProfile } from '../route';

function createRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`https://app.example.com${path}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'req_profile_routes',
    },
    body: JSON.stringify(body),
  });
}

function createPasswordRequest(body: unknown): NextRequest {
  return new NextRequest('https://app.example.com/api/user/profile/password', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'req_profile_routes',
    },
    body: JSON.stringify(body),
  });
}

function createGetRequest(path: string): NextRequest {
  return new NextRequest(`https://app.example.com${path}`, {
    method: 'GET',
    headers: {
      'x-request-id': 'req_profile_routes',
    },
  });
}

const routeContext = {
  params: Promise.resolve({}),
};

describe('user profile routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertValuesMocks.length = 0;
    updateSetMocks.length = 0;
    getSessionMock.mockResolvedValue({
      session: { id: 'session_1' },
      user: { id: 'user_1', email: 'user@example.com' },
    });
    requireUserContextMock.mockImplementation((_userId, callback) => callback(mockDb));
    mockDb.update.mockImplementation(() => {
      const where = vi.fn().mockResolvedValue(undefined);
      const set = vi.fn(() => ({ where }));
      updateSetMocks.push(set);
      return { set };
    });
    mockDb.insert.mockReturnValue({
      values: vi.fn((values) => {
        insertValuesMocks.push(values);
        return Promise.resolve(values);
      }),
    });
  });

  it('updates the current profile inside the authenticated user DB context', async () => {
    mockDb.query.user.findFirst
      .mockResolvedValueOnce({ id: 'user_1', name: 'Old', email: 'user@example.com', image: null })
      .mockResolvedValueOnce({
        id: 'user_1',
        name: '李小明',
        email: 'user@example.com',
        image: 'https://example.com/avatar.png',
      });

    const response = await updateProfile(
      createRequest('/api/user/profile', {
        name: '李小明',
        image: 'https://example.com/avatar.png',
      }),
      routeContext
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.user).toMatchObject({
      id: 'user_1',
      name: '李小明',
      image: 'https://example.com/avatar.png',
    });
    expect(requireUserContextMock).toHaveBeenCalledWith('user_1', expect.any(Function));
    expect(updateSetMocks[0]).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '李小明',
        image: 'https://example.com/avatar.png',
      })
    );
  });

  it('updates preferences in one authenticated user DB context', async () => {
    mockDb.query.userProfiles.findFirst.mockResolvedValue({
      userId: 'user_1',
      preferences: {
        language: 'en',
      },
    });

    const response = await updatePreferences(
      createRequest('/api/user/profile/preferences', {
        theme: 'dark',
        language: 'zh',
      }),
      routeContext
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.preferences).toMatchObject({
      language: 'zh',
      theme: 'dark',
    });
    expect(requireUserContextMock).toHaveBeenCalledTimes(1);
    expect(requireUserContextMock).toHaveBeenCalledWith('user_1', expect.any(Function));
  });

  it('changes password inside the authenticated user DB context', async () => {
    mockDb.query.account.findFirst.mockResolvedValue({
      id: 'account_1',
      userId: 'user_1',
      providerId: 'credential',
      password: 'old_hash',
    });
    verifyPasswordMock.mockResolvedValue(true);
    hashPasswordMock.mockResolvedValue('new_hash');

    const response = await changePassword(
      createPasswordRequest({
        currentPassword: 'OldPassword1',
        newPassword: 'NewPassword1',
        confirmPassword: 'NewPassword1',
      }),
      routeContext
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
    });
    expect(requireUserContextMock).toHaveBeenCalledWith('user_1', expect.any(Function));
    expect(updateSetMocks[0]).toHaveBeenCalledWith(
      expect.objectContaining({
        password: 'new_hash',
      })
    );
  });

  it('reports password capability for credential accounts', async () => {
    mockDb.query.account.findFirst.mockResolvedValue({
      id: 'account_1',
      userId: 'user_1',
      providerId: 'credential',
      password: 'old_hash',
    });

    const response = await getPasswordCapability(
      createGetRequest('/api/user/profile/password'),
      routeContext
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      hasPassword: true,
      mode: 'change',
    });
  });

  it('sets a password for accounts without credential password', async () => {
    mockDb.query.account.findFirst.mockResolvedValue(null);
    hashPasswordMock.mockResolvedValue('new_hash');

    const response = await changePassword(
      createPasswordRequest({
        newPassword: 'NewPassword1',
        confirmPassword: 'NewPassword1',
      }),
      routeContext
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      mode: 'set',
    });
    expect(insertValuesMocks[0]).toMatchObject({
      providerId: 'credential',
      accountId: 'user@example.com',
      userId: 'user_1',
      password: 'new_hash',
    });
  });
});
