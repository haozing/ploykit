/**
 * Permissions System Tests
 *
 * Tests for auth/permissions.ts - RBAC system
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMockDb,
  createMockTransaction,
  createMockCache,
  createMockrole,
  createMockuserrole,
} from './helpers';

//
// Mock Setup
//

const { mockDb, mockQuery: mockDbQuery } = createMockDb();
const {
  cacheStore,
  mockuserroleCache,
  mockuserPermissionCache,
  mockInvalidateuserroleCache,
  mockInvalidateuserEntitlementCache,
} = createMockCache();

// Hoist mocks
vi.mock('@/lib/db', () => ({ db: mockDb }));

vi.mock('@/lib/cache/cache-manager', () => ({
  userRoleCache: mockuserroleCache,
  userPermissionCache: mockuserPermissionCache,
}));

vi.mock('@/lib/cache/invalidation', () => ({
  invalidateUserRoleCache: mockInvalidateuserroleCache,
  invalidateUserEntitlementCache: mockInvalidateuserEntitlementCache,
}));

vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return {
    ...actual,
    eq: vi.fn((...args) => ({ type: 'eq', args })),
    and: vi.fn((...args) => ({ type: 'and', args })),
    or: vi.fn((...args) => ({ type: 'or', args })),
    isNull: vi.fn((...args) => ({ type: 'isNull', args })),
    gt: vi.fn((...args) => ({ type: 'gt', args })),
  };
});

vi.mock('@/lib/db/schema', () => ({
  userroles: { userId: 'userId', roleId: 'roleId', expiresAt: 'expiresAt' },
  roles: { id: 'id', slug: 'slug', isDefault: 'isDefault', permissions: 'permissions' },
}));

//
// Tests
//

describe('permissions.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheStore.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  //
  // assignRole() Tests
  //

  describe('assignRole()', () => {
    it('shouldSuccess分配role（独立调用，UseGlobal db）', async () => {
      const { assignRole } = await import('../permissions');

      const mockrole = createMockrole({ id: 'role-123', slug: 'admin' });

      // Mock role lookup
      mockDbQuery.roles.findFirst.mockResolvedValueOnce(mockrole);

      // Mock existing check (not found)
      mockDbQuery.userroles.findFirst.mockResolvedValueOnce(null);

      // Mock insert
      mockDb.insert.mockReturnThis();
      mockDb.values.mockResolvedValueOnce(undefined);

      await assignRole('user-123', 'admin');

      expect(mockDbQuery.roles.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ type: 'eq' }),
      });

      expect(mockDbQuery.userroles.findFirst).toHaveBeenCalledTimes(1);

      // ValidationInsert
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith({
        userId: 'user-123',
        roleId: 'role-123',
        grantedBy: undefined,
      });

      expect(mockInvalidateuserroleCache).toHaveBeenCalledWith('user-123');
    });

    it('shouldat事务in分配role（传递 tx，不失效缓存）', async () => {
      const { assignRole } = await import('../permissions');

      const { mockTx, mockQuery: mockTxQuery } = createMockTransaction();
      const mockrole = createMockrole({ id: 'role-123', slug: 'admin' });

      // Mock role lookup
      mockTxQuery.roles.findFirst.mockResolvedValueOnce(mockrole);

      // Mock existing check (not found)
      mockTxQuery.userroles.findFirst.mockResolvedValueOnce(null);

      // Mock insert
      mockTx.insert.mockReturnThis();
      mockTx.values.mockResolvedValueOnce(undefined);

      await assignRole('user-123', 'admin', undefined, mockTx as any);

      expect(mockTxQuery.roles.findFirst).toHaveBeenCalledTimes(1);
      expect(mockTxQuery.userroles.findFirst).toHaveBeenCalledTimes(1);
      expect(mockTx.insert).toHaveBeenCalled();

      expect(mockDbQuery.roles.findFirst).not.toHaveBeenCalled();
      expect(mockDbQuery.userroles.findFirst).not.toHaveBeenCalled();

      expect(mockInvalidateuserroleCache).not.toHaveBeenCalled();
    });

    it('should处理roledoes not existof情况', async () => {
      const { assignRole } = await import('../permissions');

      // Mock role lookup (not found)
      mockDbQuery.roles.findFirst.mockResolvedValueOnce(null);

      await expect(assignRole('user-123', 'nonexistent')).rejects.toThrow(
        'Role not found: nonexistent'
      );

      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockInvalidateuserroleCache).not.toHaveBeenCalled();
    });

    it('should处理user已有该roleof情况', async () => {
      const { assignRole } = await import('../permissions');

      const mockrole = createMockrole({ id: 'role-123', slug: 'admin' });
      const mockuserrole = createMockuserrole({
        userId: 'user-123',
        roleId: 'role-123',
      });

      // Mock role lookup
      mockDbQuery.roles.findFirst.mockResolvedValueOnce(mockrole);

      // Mock existing check (found)
      mockDbQuery.userroles.findFirst.mockResolvedValueOnce(mockuserrole);

      await assignRole('user-123', 'admin');

      expect(mockDb.insert).not.toHaveBeenCalled();

      expect(mockInvalidateuserroleCache).not.toHaveBeenCalled();
    });

    it('should传递 grantedBy Parameter', async () => {
      const { assignRole } = await import('../permissions');

      const mockrole = createMockrole({ id: 'role-123', slug: 'admin' });

      mockDbQuery.roles.findFirst.mockResolvedValueOnce(mockrole);
      mockDbQuery.userroles.findFirst.mockResolvedValueOnce(null);

      mockDb.insert.mockReturnThis();
      mockDb.values.mockResolvedValueOnce(undefined);

      await assignRole('user-123', 'admin', 'admin-456');

      expect(mockDb.values).toHaveBeenCalledWith({
        userId: 'user-123',
        roleId: 'role-123',
        grantedBy: 'admin-456',
      });
    });
  });

  //
  // removeRole() Tests
  //

  describe('removeRole()', () => {
    it('shouldSuccess移除role（独立调用）', async () => {
      const { removeRole } = await import('../permissions');

      const mockrole = createMockrole({ id: 'role-123', slug: 'admin' });

      // Mock role lookup
      mockDbQuery.roles.findFirst.mockResolvedValueOnce(mockrole);

      // Mock delete
      mockDb.delete.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(undefined);

      await removeRole('user-123', 'admin');

      expect(mockDbQuery.roles.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ type: 'eq' }),
      });

      // ValidationDelete
      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();

      expect(mockInvalidateuserroleCache).toHaveBeenCalledWith('user-123');
    });

    it('shouldat事务in移除role（传递 tx，不失效缓存）', async () => {
      const { removeRole } = await import('../permissions');

      const { mockTx, mockQuery: mockTxQuery } = createMockTransaction();
      const mockrole = createMockrole({ id: 'role-123', slug: 'admin' });

      // Mock role lookup
      mockTxQuery.roles.findFirst.mockResolvedValueOnce(mockrole);

      // Mock delete
      mockTx.delete.mockReturnThis();
      mockTx.where.mockResolvedValueOnce(undefined);

      await removeRole('user-123', 'admin', mockTx as any);

      expect(mockTxQuery.roles.findFirst).toHaveBeenCalledTimes(1);
      expect(mockTx.delete).toHaveBeenCalled();

      expect(mockDbQuery.roles.findFirst).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();

      expect(mockInvalidateuserroleCache).not.toHaveBeenCalled();
    });

    it('should处理roledoes not existof情况（静默Back）', async () => {
      const { removeRole } = await import('../permissions');

      // Mock role lookup (not found)
      mockDbQuery.roles.findFirst.mockResolvedValueOnce(null);

      await removeRole('user-123', 'nonexistent');

      expect(mockDb.delete).not.toHaveBeenCalled();
      expect(mockInvalidateuserroleCache).not.toHaveBeenCalled();
    });
  });

  //
  // getUserRoles() Tests
  //

  describe('getUserRoles()', () => {
    it('shouldfromDatabaseQueryuserrole', async () => {
      const { getUserRoles } = await import('../permissions');

      const mockResult = [{ roleSlug: 'admin' }, { roleSlug: 'user' }];

      mockDb.select.mockReturnThis();
      mockDb.from.mockReturnThis();
      mockDb.innerJoin.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(mockResult);

      const roles = await getUserRoles('user-123');

      expect(roles).toEqual(['admin', 'user']);
      expect(mockDb.select).toHaveBeenCalled();

      expect(mockuserroleCache.set).toHaveBeenCalledWith('roles:user-123', ['admin', 'user']);
    });

    it('shouldfrom缓存readrole', async () => {
      const { getUserRoles } = await import('../permissions');

      mockuserroleCache.get.mockReturnValueOnce(['admin', 'user']);

      const roles = await getUserRoles('user-123');

      expect(roles).toEqual(['admin', 'user']);

      expect(mockuserroleCache.get).toHaveBeenCalledWith('roles:user-123');

      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('should处理user没有roleof情况', async () => {
      const { getUserRoles } = await import('../permissions');

      mockDb.select.mockReturnThis();
      mockDb.from.mockReturnThis();
      mockDb.innerJoin.mockReturnThis();
      mockDb.where.mockResolvedValueOnce([]);

      const roles = await getUserRoles('user-123');

      expect(roles).toEqual([]);
      expect(mockuserroleCache.set).toHaveBeenCalledWith('roles:user-123', []);
    });
  });

  //
  // getUserPermissions() Tests
  //

  describe('getUserPermissions()', () => {
    it('shouldfromDatabaseQueryuserPermission并去重', async () => {
      const { getUserPermissions } = await import('../permissions');

      const mockResult = [
        { permissions: ['profile:view:self', 'profile:edit:self'] },
        { permissions: ['profile:view:self', 'admin:access:all'] },
      ];

      mockDb.select.mockReturnThis();
      mockDb.from.mockReturnThis();
      mockDb.innerJoin.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(mockResult);

      const permissions = await getUserPermissions('user-123');

      expect(permissions).toEqual(['profile:view:self', 'profile:edit:self', 'admin:access:all']);

      expect(mockuserPermissionCache.set).toHaveBeenCalledWith('permissions:user-123', [
        'profile:view:self',
        'profile:edit:self',
        'admin:access:all',
      ]);
    });

    it('shouldfrom缓存readPermission', async () => {
      const { getUserPermissions } = await import('../permissions');

      mockuserPermissionCache.get.mockReturnValueOnce(['profile:view:self', 'admin:access:all']);

      const permissions = await getUserPermissions('user-123');

      expect(permissions).toEqual(['profile:view:self', 'admin:access:all']);

      expect(mockuserPermissionCache.get).toHaveBeenCalledWith('permissions:user-123');

      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('should处理空Permissionof情况', async () => {
      const { getUserPermissions } = await import('../permissions');

      const mockResult = [{ permissions: null }, { permissions: [] }];

      mockDb.select.mockReturnThis();
      mockDb.from.mockReturnThis();
      mockDb.innerJoin.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(mockResult);

      const permissions = await getUserPermissions('user-123');

      expect(permissions).toEqual([]);
    });
  });

  //
  // isAdmin() Tests
  //

  describe('isAdmin()', () => {
    it('should正确识别Admin', async () => {
      const { isAdmin } = await import('../permissions');

      const mockResult = [{ roleSlug: 'admin' }, { roleSlug: 'user' }];

      mockDb.select.mockReturnThis();
      mockDb.from.mockReturnThis();
      mockDb.innerJoin.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(mockResult);

      const result = await isAdmin('user-123');

      expect(result).toBe(true);
    });

    it('should正确识别非Admin', async () => {
      const { isAdmin } = await import('../permissions');

      const mockResult = [{ roleSlug: 'user' }];

      mockDb.select.mockReturnThis();
      mockDb.from.mockReturnThis();
      mockDb.innerJoin.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(mockResult);

      const result = await isAdmin('user-123');

      expect(result).toBe(false);
    });
  });

  //
  // hasPermission() Tests
  //

  describe('hasPermission()', () => {
    it('should正确Checkuser有该Permission', async () => {
      const { hasPermission, PERMISSIONS } = await import('../permissions');

      const mockResult = [
        { permissions: ['profile:view:self', 'profile:edit:self', 'admin:access:all'] },
      ];

      mockDb.select.mockReturnThis();
      mockDb.from.mockReturnThis();
      mockDb.innerJoin.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(mockResult);

      const result = await hasPermission('user-123', PERMISSIONS.ADMIN_ACCESS);

      expect(result).toBe(true);
    });

    it('should正确Checkuser没有该Permission', async () => {
      const { hasPermission, PERMISSIONS } = await import('../permissions');

      const mockResult = [{ permissions: ['profile:view:self', 'profile:edit:self'] }];

      mockDb.select.mockReturnThis();
      mockDb.from.mockReturnThis();
      mockDb.innerJoin.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(mockResult);

      const result = await hasPermission('user-123', PERMISSIONS.ADMIN_ACCESS);

      expect(result).toBe(false);
    });

    it('should match wildcard permissions with *:*:*', async () => {
      const { hasPermission, PERMISSIONS } = await import('../permissions');

      // User has super admin permission *:*:*
      const mockResult = [{ permissions: ['*:*:*'] }];

      mockDb.select.mockReturnThis();
      mockDb.from.mockReturnThis();
      mockDb.innerJoin.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(mockResult);

      const result = await hasPermission('user-123', PERMISSIONS.ADMIN_ACCESS);

      expect(result).toBe(true);
    });

    it('should match partial wildcard permissions', async () => {
      const { hasPermission, PERMISSIONS } = await import('../permissions');

      const mockResult = [{ permissions: ['admin:*:*'] }];

      mockDb.select.mockReturnThis();
      mockDb.from.mockReturnThis();
      mockDb.innerJoin.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(mockResult);

      const result = await hasPermission('user-123', PERMISSIONS.ADMIN_ACCESS);

      expect(result).toBe(true);
    });

    it('should not match unrelated wildcard permissions', async () => {
      const { hasPermission, PERMISSIONS } = await import('../permissions');

      const mockResult = [{ permissions: ['user:*:*'] }];

      mockDb.select.mockReturnThis();
      mockDb.from.mockReturnThis();
      mockDb.innerJoin.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(mockResult);

      const result = await hasPermission('user-123', PERMISSIONS.ADMIN_ACCESS);

      expect(result).toBe(false);
    });
  });

  //
  // hasAllPermissions() Tests
  //

  describe('hasAllPermissions()', () => {
    it('should正确Checkuser有AllPermission', async () => {
      const { hasAllPermissions, PERMISSIONS } = await import('../permissions');

      const mockResult = [
        {
          permissions: [
            'profile:view:self',
            'profile:edit:self',
            'admin:access:all',
            'user:manage:all',
          ],
        },
      ];

      mockDb.select.mockReturnThis();
      mockDb.from.mockReturnThis();
      mockDb.innerJoin.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(mockResult);

      const result = await hasAllPermissions('user-123', [
        PERMISSIONS.ADMIN_ACCESS,
        PERMISSIONS.USER_MANAGE,
      ]);

      expect(result).toBe(true);
    });

    it('should正确CheckuserMissing某些Permission', async () => {
      const { hasAllPermissions, PERMISSIONS } = await import('../permissions');

      const mockResult = [{ permissions: ['profile:view:self', 'admin:access:all'] }];

      mockDb.select.mockReturnThis();
      mockDb.from.mockReturnThis();
      mockDb.innerJoin.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(mockResult);

      const result = await hasAllPermissions('user-123', [
        PERMISSIONS.ADMIN_ACCESS,
        PERMISSIONS.USER_MANAGE, // Missing这
      ]);

      expect(result).toBe(false);
    });
  });

  //
  // hasAnyPermission() Tests
  //

  describe('hasAnyPermission()', () => {
    it('should正确Checkuser有任一Permission', async () => {
      const { hasAnyPermission, PERMISSIONS } = await import('../permissions');

      const mockResult = [{ permissions: ['profile:view:self', 'admin:access:all'] }];

      mockDb.select.mockReturnThis();
      mockDb.from.mockReturnThis();
      mockDb.innerJoin.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(mockResult);

      const result = await hasAnyPermission('user-123', [
        PERMISSIONS.USER_MANAGE,
        PERMISSIONS.ADMIN_ACCESS,
      ]);

      expect(result).toBe(true);
    });

    it('should正确Checkuser没有任何Permission', async () => {
      const { hasAnyPermission, PERMISSIONS } = await import('../permissions');

      const mockResult = [{ permissions: ['profile:view:self'] }];

      mockDb.select.mockReturnThis();
      mockDb.from.mockReturnThis();
      mockDb.innerJoin.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(mockResult);

      const result = await hasAnyPermission('user-123', [
        PERMISSIONS.ADMIN_ACCESS,
        PERMISSIONS.USER_MANAGE,
      ]);

      expect(result).toBe(false);
    });
  });
});
