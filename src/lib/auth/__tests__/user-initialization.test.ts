import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDb,
  assignRoleMock,
  createDefaultEntitlementMock,
  invalidateUserRoleCacheMock,
  invalidateUserEntitlementCacheMock,
  insertValuesMock,
} = vi.hoisted(() => ({
  assignRoleMock: vi.fn(),
  createDefaultEntitlementMock: vi.fn(),
  invalidateUserRoleCacheMock: vi.fn(),
  invalidateUserEntitlementCacheMock: vi.fn(),
  insertValuesMock: vi.fn(),
  mockDb: {
    query: {
      userProfiles: {
        findFirst: vi.fn(),
      },
      roles: {
        findFirst: vi.fn(),
      },
      userEntitlements: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({
  withSystemContext: vi.fn((callback) => callback(mockDb)),
}));

vi.mock('@/lib/auth/permissions', () => ({
  assignRole: assignRoleMock,
}));

vi.mock('@/lib/services/user/user-entitlement-service', () => ({
  createDefaultEntitlement: createDefaultEntitlementMock,
}));

vi.mock('@/lib/cache', () => ({
  invalidateUserRoleCache: invalidateUserRoleCacheMock,
  invalidateUserEntitlementCache: invalidateUserEntitlementCacheMock,
}));

vi.mock('@/lib/_core/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  roles: { isDefault: 'roles.isDefault' },
  userEntitlements: {
    userId: 'userEntitlements.userId',
    status: 'userEntitlements.status',
  },
  userProfiles: { userId: 'userProfiles.userId' },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions) => ({ op: 'and', conditions })),
  eq: vi.fn((left, right) => ({ op: 'eq', left, right })),
}));

import { ensureUserInitialized } from '../user-initialization.server';

describe('user initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.query.userProfiles.findFirst.mockResolvedValue(null);
    mockDb.query.roles.findFirst.mockResolvedValue({ id: 'role_1', slug: 'user' });
    mockDb.query.userEntitlements.findFirst.mockResolvedValue(null);
    assignRoleMock.mockResolvedValue(undefined);
    createDefaultEntitlementMock.mockResolvedValue({ id: 'entitlement_1' });
    insertValuesMock.mockResolvedValue(undefined);
    mockDb.insert.mockReturnValue({ values: insertValuesMock });
  });

  it('creates profile, default role and default entitlement for a new user', async () => {
    await ensureUserInitialized({
      userId: 'user_1',
      email: 'user@example.com',
      source: 'email',
    });

    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        metadata: {
          registrationSource: 'email',
          onboardingCompleted: false,
        },
      })
    );
    expect(assignRoleMock).toHaveBeenCalledWith('user_1', 'user', undefined, mockDb);
    expect(createDefaultEntitlementMock).toHaveBeenCalledWith('user_1', mockDb);
    expect(invalidateUserRoleCacheMock).toHaveBeenCalledWith('user_1');
    expect(invalidateUserEntitlementCacheMock).toHaveBeenCalledWith('user_1');
  });

  it('is idempotent for users that already have a profile and entitlement', async () => {
    mockDb.query.userProfiles.findFirst.mockResolvedValue({ id: 'profile_1' });
    mockDb.query.userEntitlements.findFirst.mockResolvedValue({ id: 'entitlement_1' });

    await ensureUserInitialized({
      userId: 'user_1',
      source: 'google',
    });

    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(assignRoleMock).toHaveBeenCalledWith('user_1', 'user', undefined, mockDb);
    expect(createDefaultEntitlementMock).not.toHaveBeenCalled();
  });

  it('fails when the default role is missing', async () => {
    mockDb.query.roles.findFirst.mockResolvedValue(null);

    await expect(
      ensureUserInitialized({
        userId: 'user_1',
        source: 'github',
      })
    ).rejects.toThrow('No default role found');

    expect(assignRoleMock).not.toHaveBeenCalled();
    expect(createDefaultEntitlementMock).not.toHaveBeenCalled();
  });
});
