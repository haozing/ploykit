/**
 * Integration Tests for RBAC (Role-Based Access Control)
 *
 * Tests cover complete user workflows:
 * - Role creation and management
 * - Role assignment and revocation
 * - Permission checking with wildcards
 * - Multi-role permission aggregation
 * - Entitlement limit enforcement
 * - Audit trail verification
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockFactories } from '@/lib/test-utils/db-mock';

// Mock modules
vi.mock('@/lib/db', () => {
  const mockDb = {
    query: {
      roles: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      userroles: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn(),
    transaction: vi.fn(),
    execute: vi.fn(),
  };

  return {
    db: mockDb,
    withSystemContext: vi.fn((callback) => callback(mockDb)),
  };
});

vi.mock('@/lib/services/audit/audit-service', () => ({
  auditLogDurable: vi.fn(),
  AUDIT_ACTIONS: {
    ROLE_CREATE: 'role.create',
    ROLE_UPDATE: 'role.update',
    ROLE_DELETE: 'role.delete',
    ROLE_ASSIGN: 'role.assign',
    ROLE_REVOKE: 'role.revoke',
  },
}));

import { db } from '@/lib/db';
import { auditLogDurable as auditLog } from '../../audit/audit-service';
import * as RoleService from '../role-service';

// Test UUIDs (valid UUID v4 format)
const TEST_IDS = {
  USER_123: '550e8400-e29b-41d4-a716-446655440001',
  USER_456: '550e8400-e29b-41d4-a716-446655440002',
  ROLE_123: '650e8400-e29b-41d4-a716-446655440001',
  ROLE_OTHER: '650e8400-e29b-41d4-a716-446655440002',
  ROLE_1: '650e8400-e29b-41d4-a716-446655440003',
  ROLE_2: '650e8400-e29b-41d4-a716-446655440004',
  ADMIN_123: '550e8400-e29b-41d4-a716-446655440010',
} as const;

describe('RBAC Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Complete Role Lifecycle', () => {
    it('should clear other default roles when creating a new default role', async () => {
      const newRole = mockFactories.role({
        id: TEST_IDS.ROLE_123,
        name: 'Default User',
        slug: 'default_user',
        isDefault: true,
        permissions: ['profile:view:self'],
      });
      const clearWhere = vi.fn().mockResolvedValue(undefined);
      const updateSet = vi.fn().mockReturnValue({ where: clearWhere });
      const insertReturning = vi.fn().mockResolvedValue([newRole]);
      const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });

      vi.mocked(db.query.roles.findFirst).mockResolvedValueOnce(undefined);
      vi.mocked((db as any).update).mockReturnValueOnce({ set: updateSet });
      vi.mocked((db as any).insert).mockReturnValueOnce({ values: insertValues });

      const created = await RoleService.createRole(
        {
          name: 'Default User',
          slug: 'default_user',
          description: 'Default role',
          permissions: ['profile:view:self'],
          isDefault: true,
        },
        TEST_IDS.ADMIN_123
      );

      expect(created).toEqual(newRole);
      expect(updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          isDefault: false,
        })
      );
      expect(clearWhere).not.toHaveBeenCalled();
      expect(insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          isDefault: true,
        })
      );
    });

    it('should clear other default roles when updating a role to default', async () => {
      const existingRole = mockFactories.role({
        id: TEST_IDS.ROLE_123,
        slug: 'member',
        isDefault: false,
      });
      const updatedRole = {
        ...existingRole,
        isDefault: true,
      };
      const clearWhere = vi.fn().mockResolvedValue(undefined);
      const updateReturning = vi.fn().mockResolvedValue([updatedRole]);
      const updateWhere = vi
        .fn()
        .mockReturnValueOnce({ returning: updateReturning })
        .mockResolvedValueOnce([]);
      const updateSet = vi
        .fn()
        .mockReturnValueOnce({ where: clearWhere })
        .mockReturnValueOnce({ where: updateWhere });
      const affectedUsersWhere = vi.fn().mockResolvedValue([]);

      vi.mocked(db.query.roles.findFirst).mockResolvedValueOnce(existingRole);
      vi.mocked((db as any).update)
        .mockReturnValueOnce({ set: updateSet })
        .mockReturnValueOnce({ set: updateSet });
      vi.mocked((db as any).select).mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: affectedUsersWhere,
        }),
      });

      const updated = await RoleService.updateRole(
        TEST_IDS.ROLE_123,
        { isDefault: true },
        TEST_IDS.ADMIN_123
      );

      expect(updated).toEqual(updatedRole);
      expect(updateSet).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          isDefault: false,
        })
      );
      expect(clearWhere).toHaveBeenCalledTimes(1);
      expect(updateReturning).toHaveBeenCalledTimes(1);
    });

    it('should create, update, and delete a role successfully', async () => {
      // 1. Create role
      const newRole = mockFactories.role({
        id: TEST_IDS.ROLE_123,
        name: 'Content Editor',
        slug: 'content_editor',
        permissions: ['content:read:all', 'content:write:own'],
      });

      vi.mocked(db.query.roles.findFirst).mockResolvedValueOnce(undefined); // No existing slug for create
      vi.mocked((db as any).returning).mockResolvedValue([newRole]);

      const created = await RoleService.createRole(
        {
          name: 'Content Editor',
          slug: 'content_editor',
          description: 'Can edit content',
          permissions: ['content:read:all', 'content:write:own'],
          isDefault: false,
        },
        TEST_IDS.ADMIN_123
      );

      expect(created).toEqual(newRole);
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'role.create',
          resourceName: 'Content Editor',
        })
      );

      // 2. Update role
      const updatedRole = {
        ...newRole,
        name: 'Senior Content Editor',
        permissions: ['content:read:all', 'content:write:all', 'content:publish:all'],
      };

      vi.mocked(db.query.roles.findFirst)
        .mockResolvedValueOnce(newRole) // Check role exists
        .mockResolvedValueOnce(undefined); // Check slug not taken
      vi.mocked((db as any).returning).mockResolvedValue([updatedRole]);
      // For the update chain, where needs to return an object with returning method
      // For the select chain (getting affected users), where returns array directly
      vi.mocked((db as any).where)
        .mockReturnValueOnce({
          returning: vi.fn().mockResolvedValue([updatedRole]),
        })
        .mockResolvedValue([]); // For getting affected users

      const updated = await RoleService.updateRole(
        TEST_IDS.ROLE_123,
        {
          name: 'Senior Content Editor',
          permissions: ['content:read:all', 'content:write:all', 'content:publish:all'],
        },
        TEST_IDS.ADMIN_123
      );

      expect(updated).toEqual(updatedRole);
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'role.update',
          metadata: expect.objectContaining({
            previousValues: expect.objectContaining({
              name: 'Content Editor',
            }),
          }),
        })
      );

      // 3. Delete role
      // Reset to clear any unused mockResolvedValueOnce from previous step
      vi.mocked(db.query.roles.findFirst).mockReset();
      vi.mocked(db.query.roles.findFirst).mockResolvedValue(updatedRole);
      vi.mocked((db as any).where).mockResolvedValue([{ count: '0' }]); // No users assigned
      vi.mocked((db as any).delete).mockReturnValue({ where: vi.fn() } as any);

      const deleteResult = await RoleService.deleteRole(TEST_IDS.ROLE_123, TEST_IDS.ADMIN_123);

      expect(deleteResult.success).toBe(true);
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'role.delete',
          resourceId: TEST_IDS.ROLE_123,
        })
      );
    });

    it('should prevent deleting roles assigned to users', async () => {
      const role = mockFactories.role();

      // Reset mock to clear any previous mockResolvedValueOnce calls
      vi.mocked(db.query.roles.findFirst).mockReset();
      vi.mocked(db.query.roles.findFirst).mockResolvedValue(role);
      vi.mocked((db as any).where).mockResolvedValue([{ count: '5' }]); // 5 users assigned

      await expect(RoleService.deleteRole(TEST_IDS.ROLE_123, TEST_IDS.ADMIN_123)).rejects.toThrow(
        'Cannot delete role: assigned to 5 users'
      );
    });
  });

  describe('Role Assignment Workflow', () => {
    it('should assign role to user with entitlement check', async () => {
      const role = mockFactories.role({
        id: TEST_IDS.ROLE_123,
        name: 'Editor',
      });
      const assignment = mockFactories.userrole({
        userId: TEST_IDS.USER_123,
        roleId: TEST_IDS.ROLE_123,
      });

      // Mock transaction
      vi.mocked((db as any).transaction).mockImplementation(async (callback: any) => {
        const mockTx = {
          query: {
            roles: {
              findFirst: vi.fn().mockResolvedValue(role),
            },
            userroles: {
              findFirst: vi.fn().mockResolvedValue(undefined), // No existing assignment
              findMany: vi.fn().mockResolvedValue([]), // No existing roles
            },
          },
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([assignment]),
            }),
          }),
        };
        return callback(mockTx);
      });
      const result = await RoleService.assignRoleToUser(
        TEST_IDS.USER_123,
        TEST_IDS.ROLE_123,
        TEST_IDS.ADMIN_123
      );

      expect(result).toEqual(assignment);
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'role.assign',
          metadata: expect.objectContaining({
            assignment: expect.objectContaining({
              isFirstRole: true,
            }),
          }),
        })
      );
    });

    it('should reject assigning additional roles (single-role system)', async () => {
      // NOTE: Current implementation uses a simplified single-role system
      // Each user can only have ONE role at a time
      const role = mockFactories.role();
      const existingRole = mockFactories.userrole({
        userId: TEST_IDS.USER_123,
        roleId: TEST_IDS.ROLE_OTHER,
      });

      // Mock transaction
      vi.mocked((db as any).transaction).mockImplementation(async (callback: any) => {
        const mockTx = {
          query: {
            roles: {
              findFirst: vi.fn().mockResolvedValue(role),
            },
            userroles: {
              findFirst: vi.fn().mockResolvedValue(undefined),
              findMany: vi.fn().mockResolvedValue([existingRole]), // User already has a role
            },
          },
        };
        return callback(mockTx);
      });

      // Should reject because user already has a role
      await expect(
        RoleService.assignRoleToUser(TEST_IDS.USER_123, TEST_IDS.ROLE_123, TEST_IDS.ADMIN_123)
      ).rejects.toThrow('User already has a role assigned');
    });

    it('should prevent duplicate role assignments', async () => {
      const role = mockFactories.role();
      const existingAssignment = mockFactories.userrole({
        userId: TEST_IDS.USER_123,
        roleId: TEST_IDS.ROLE_123,
      });

      // Mock transaction
      vi.mocked((db as any).transaction).mockImplementation(async (callback: any) => {
        const mockTx = {
          query: {
            roles: {
              findFirst: vi.fn().mockResolvedValue(role),
            },
            userroles: {
              findFirst: vi.fn().mockResolvedValue(existingAssignment), // Already assigned
            },
          },
        };
        return callback(mockTx);
      });

      await expect(
        RoleService.assignRoleToUser(TEST_IDS.USER_123, TEST_IDS.ROLE_123, TEST_IDS.ADMIN_123)
      ).rejects.toThrow('Role already assigned to user');
    });
  });

  describe('Role Revocation Workflow', () => {
    it('should revoke last role and track user removal', async () => {
      const assignment = mockFactories.userrole({
        userId: TEST_IDS.USER_123,
        roleId: TEST_IDS.ROLE_123,
      });

      // Mock transaction to execute the callback with a mock tx object
      vi.mocked((db as any).transaction).mockImplementation(async (callback: any) => {
        const mockTx = {
          query: {
            userroles: {
              findFirst: vi.fn().mockResolvedValue(assignment),
              findMany: vi.fn().mockResolvedValue([assignment]), // Only one role
            },
          },
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        };
        return callback(mockTx);
      });

      const result = await RoleService.revokeRoleFromUser(
        TEST_IDS.USER_123,
        TEST_IDS.ROLE_123,
        TEST_IDS.ADMIN_123
      );

      expect(result.success).toBe(true);
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'role.revoke',
          metadata: expect.objectContaining({
            revocation: expect.objectContaining({
              isLastRole: true,
            }),
          }),
        })
      );
    });

    it('should revoke role without tracking when user has other roles', async () => {
      const assignment = mockFactories.userrole();
      const otherAssignment = mockFactories.userrole({
        roleId: TEST_IDS.ROLE_OTHER,
      });

      // Mock transaction to execute the callback with a mock tx object
      vi.mocked((db as any).transaction).mockImplementation(async (callback: any) => {
        const mockTx = {
          query: {
            userroles: {
              findFirst: vi.fn().mockResolvedValue(assignment),
              findMany: vi.fn().mockResolvedValue([assignment, otherAssignment]),
            },
          },
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        };
        return callback(mockTx);
      });

      await RoleService.revokeRoleFromUser(
        TEST_IDS.USER_123,
        TEST_IDS.ROLE_123,
        TEST_IDS.ADMIN_123
      );

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            revocation: expect.objectContaining({
              isLastRole: false,
            }),
          }),
        })
      );
    });
  });

  // NOTE: Permission checking tests (getUserPermissions, userHasPermission, wildcard matching)
  // have been moved to src/lib/auth/__tests__/permissions.test.ts
  // The role-service now focuses on role CRUD and assignment operations only.
  // For permission checking, use hasPermission() from '@/lib/auth/permissions'

  describe('Role Listing and Filtering', () => {
    // Helper to create chainable mock for listRoles query
    const setupListRolesMock = (roles: any[], totalCount: number) => {
      // First call: db.select().from().leftJoin().where().groupBy().orderBy().limit().offset()
      const rolesChainMock = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue(roles),
      };

      // Second call: db.select().from().where() for count
      const countChainMock = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ count: String(totalCount) }]),
      };

      vi.mocked((db as any).select)
        .mockReturnValueOnce(rolesChainMock)
        .mockReturnValueOnce(countChainMock);
    };

    it('should list roles with pagination', async () => {
      const mockRoles = [
        { ...mockFactories.role({ id: TEST_IDS.ROLE_1, name: 'Admin' }), userCount: 0 },
        { ...mockFactories.role({ id: TEST_IDS.ROLE_2, name: 'Editor' }), userCount: 5 },
      ];

      setupListRolesMock(mockRoles, 2);

      const result = await RoleService.listRoles({
        page: 1,
        limit: 10,
      });

      expect(result.roles).toHaveLength(2);
      expect(result.roles[0].userCount).toBe(0);
      expect(result.roles[1].userCount).toBe(5);
      expect(result.pagination).toEqual(
        expect.objectContaining({
          page: 1,
          limit: 10,
          total: 2,
          totalPages: 1,
        })
      );
    });

    it('should filter roles by search term', async () => {
      const mockRoles = [
        { ...mockFactories.role({ name: 'Content Editor', slug: 'content_editor' }), userCount: 3 },
      ];

      setupListRolesMock(mockRoles, 1);

      const result = await RoleService.listRoles({
        search: 'editor',
        page: 1,
        limit: 10,
      });

      expect(result.roles).toHaveLength(1);
      expect(result.roles[0].name).toBe('Content Editor');
    });
  });

  describe('Role Statistics', () => {
    it('should calculate role statistics', async () => {
      // First call: db.select().from() for total roles count
      const totalChainMock = {
        from: vi.fn().mockResolvedValue([{ count: '50' }]),
      };

      // Second call: db.select().from().where() for assignment count
      const assignedChainMock = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ count: '150' }]),
      };

      vi.mocked((db as any).select)
        .mockReturnValueOnce(totalChainMock)
        .mockReturnValueOnce(assignedChainMock);

      const stats = await RoleService.getRoleStats();

      expect(stats).toEqual({
        total: 50,
        assigned: 150,
      });
    });
  });
});
