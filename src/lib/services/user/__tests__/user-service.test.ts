import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError } from '@/lib/_core/errors';

const { auditLogMock, mockDb, updateSetMocks, withSystemContextMock } = vi.hoisted(() => {
  const updateSetMocks: Array<ReturnType<typeof vi.fn>> = [];

  const mockDb = {
    query: {
      user: {
        findFirst: vi.fn(),
      },
      userProfiles: {
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
      values: vi.fn().mockResolvedValue(undefined),
    })),
    select: vi.fn(),
  };

  return {
    auditLogMock: vi.fn(),
    mockDb,
    updateSetMocks,
    withSystemContextMock: vi.fn((callback) => callback(mockDb)),
  };
});

vi.mock('@/lib/db', () => ({
  withSystemContext: withSystemContextMock,
}));

vi.mock('@/lib/services/audit/audit-service', () => ({
  auditLog: auditLogMock,
  AUDIT_ACTIONS: {
    USER_UPDATE: 'user.update',
    USER_DELETE: 'user.delete',
  },
}));

import { updateUser } from '../user-service';

function mockSelectResult(row: Record<string, unknown>) {
  const chain = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn().mockResolvedValue([row]),
  };

  mockDb.select.mockReturnValue(chain);
  return chain;
}

describe('user service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSetMocks.length = 0;
    mockDb.update.mockImplementation(() => {
      const where = vi.fn().mockResolvedValue(undefined);
      const set = vi.fn(() => ({ where }));
      updateSetMocks.push(set);
      return { set };
    });
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
    withSystemContextMock.mockImplementation((callback) => callback(mockDb));
  });

  it('updates Better Auth user fields from the admin update path and returns full user details', async () => {
    const existingUser = {
      id: 'user_1',
      email: 'old@example.com',
      name: 'Old Name',
      image: null,
    };
    const updatedAt = new Date('2026-05-09T09:00:00.000Z');

    mockDb.query.user.findFirst
      .mockResolvedValueOnce(existingUser)
      .mockResolvedValueOnce(undefined);
    mockDb.query.userProfiles.findFirst.mockResolvedValueOnce({
      userId: 'user_1',
      preferences: {},
      metadata: {},
    });
    mockSelectResult({
      id: 'user_1',
      email: 'new@example.com',
      name: 'New Name',
      image: 'https://example.com/avatar.png',
      emailVerified: true,
      createdAt: updatedAt,
      updatedAt,
      profileMetadata: {},
      profilePreferences: {},
      profileDeletedAt: null,
      profileDeletedBy: null,
      profileCreatedAt: updatedAt,
      profileUpdatedAt: updatedAt,
      roleId: 'role_1',
      roleName: 'User',
      roleSlug: 'user',
    });

    const result = await updateUser(
      'user_1',
      {
        name: 'New Name',
        email: 'new@example.com',
        image: 'https://example.com/avatar.png',
      },
      'admin_1',
      '127.0.0.1'
    );

    expect(result).toMatchObject({
      id: 'user_1',
      email: 'new@example.com',
      name: 'New Name',
      image: 'https://example.com/avatar.png',
      status: 'active',
      role: {
        slug: 'user',
      },
    });
    expect(updateSetMocks[0]).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New Name',
        email: 'new@example.com',
        image: 'https://example.com/avatar.png',
      })
    );
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin_1',
        action: 'user.update',
        resource: 'user',
        resourceId: 'user_1',
        ipAddress: '127.0.0.1',
      })
    );
  });

  it('rejects updating a user to an email owned by another user', async () => {
    mockDb.query.user.findFirst
      .mockResolvedValueOnce({
        id: 'user_1',
        email: 'old@example.com',
        name: 'Old Name',
      })
      .mockResolvedValueOnce({
        id: 'user_2',
        email: 'new@example.com',
      });

    await expect(
      updateUser('user_1', { email: 'new@example.com' }, 'admin_1')
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(auditLogMock).not.toHaveBeenCalled();
  });
});
