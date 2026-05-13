import { db, withSystemContext, type Database } from '@/lib/db';
import { roles, userroles } from '@/lib/db/schema';
import { eq, and, or, like, desc, sql, isNull, gt } from 'drizzle-orm';
import { auditLogDurable, AUDIT_ACTIONS } from '@/lib/services/audit/audit-service';
import {
  createRoleSchema,
  updateRoleSchema,
  assignRoleSchema,
  type CreateRoleInput,
  type UpdateRoleInput,
} from '@/lib/validations';
import { ConflictError, NotFoundError, ForbiddenError } from '@/lib/_core/errors';
import { invalidateUserRoleCache, invalidateUserRoleCacheBatch } from '@/lib/cache';

/**
 * Role Service
 *
 * Business logic for role management:
 * - List roles
 * - Get role details with permissions
 * - Create, update, delete roles
 * - Assign/revoke roles to users
 * - Check user permissions
 */

/**
 * Predefined Role Templates
 *
 * Role templates for user-level architecture (single-user system).
 * This system uses only two roles: admin and user.
 *
 * Permission format: resource:action:scope
 *
 * Wildcards:
 * - `*` in resource: All resources
 * - `*` in action: All actions
 * - `*` in scope: All scopes
 */
export const ROLE_TEMPLATES = {
  /**
   * System Administrator
   * - Full system access
   * - Can manage users, roles, plans, and system configuration
   */
  ADMIN: {
    name: 'Admin',
    slug: 'admin',
    description: 'System administrator with full access',
    permissions: [
      'admin:access:all',
      'user:manage:all',
      'role:manage:all',
      'plan:manage:all',
      'billing:manage:all',
      'invoice:manage:all',
      'payment_method:manage:all',
      'tax_profile:manage:all',
      'credit:manage:all',
      'credit:reconcile:all',
      'audit:export:all',
      'audit:retention:all',
      'file:manage:all',
      'file:retention:all',
      'outbox:manage:all',
      'webhook:retry:all',
      'reliability:read:all',
      'edge_access_log:read:all',
      'edge_access_log:ingest:all',
      'system:config:all',
    ],
    isDefault: false,
  },

  /**
   * Regular User
   * - Basic account access
   * - Can manage their own profile and account settings
   */
  USER: {
    name: 'User',
    slug: 'user',
    description: 'Regular user with basic permissions',
    permissions: ['profile:edit:self', 'profile:view:self', 'account:manage:self'],
    isDefault: true, // Default role for new users
  },
} as const;

// // Types and Interfaces
//
export interface RoleFilters {
  search?: string;
  page?: number;
  limit?: number;
}

export interface RoleWithDetails {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  permissions: string[];
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  userCount?: number;
}

async function clearOtherDefaultRoles(database: Database, roleId?: string): Promise<void> {
  const query = database.update(roles).set({ isDefault: false, updatedAt: new Date() });

  if (roleId) {
    await query.where(sql`${roles.id} <> ${roleId}`);
    return;
  }

  await query;
}

/**
 * List roles with filtering and pagination
 */
export async function listRoles(filters: RoleFilters = {}) {
  const { search, page = 1, limit = 20 } = filters;

  const offset = (page - 1) * limit;

  // Build where conditions
  const conditions = [];

  if (search) {
    conditions.push(or(like(roles.name, `%${search}%`), like(roles.slug, `%${search}%`)));
  }

  // Build where clause
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Execute query with LEFT JOIN to get user counts in single query
  const rolesWithCounts = await db
    .select({
      id: roles.id,
      name: roles.name,
      slug: roles.slug,
      description: roles.description,
      permissions: roles.permissions,
      isDefault: roles.isDefault,
      createdAt: roles.createdAt,
      updatedAt: roles.updatedAt,
      userCount: sql<number>`COALESCE(COUNT(${userroles.id}), 0)`,
    })
    .from(roles)
    .leftJoin(userroles, eq(roles.id, userroles.roleId))
    .where(whereClause)
    .groupBy(
      roles.id,
      roles.name,
      roles.slug,
      roles.description,
      roles.permissions,
      roles.isDefault,
      roles.createdAt,
      roles.updatedAt
    )
    .orderBy(desc(roles.createdAt))
    .limit(limit)
    .offset(offset);

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(roles)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const total = Number(countResult[0]?.count || 0);
  const totalPages = Math.ceil(total / limit);

  return {
    roles: rolesWithCounts,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

/**
 * Get role by ID with full details
 */
export async function getRoleById(roleId: string): Promise<RoleWithDetails | null> {
  // Single query with LEFT JOIN to get user count
  const result = await db
    .select({
      id: roles.id,
      name: roles.name,
      slug: roles.slug,
      description: roles.description,
      permissions: roles.permissions,
      isDefault: roles.isDefault,
      createdAt: roles.createdAt,
      updatedAt: roles.updatedAt,
      userCount: sql<number>`COALESCE(COUNT(${userroles.id}), 0)`,
    })
    .from(roles)
    .leftJoin(userroles, eq(roles.id, userroles.roleId))
    .where(eq(roles.id, roleId))
    .groupBy(
      roles.id,
      roles.name,
      roles.slug,
      roles.description,
      roles.permissions,
      roles.isDefault,
      roles.createdAt,
      roles.updatedAt
    );

  if (!result || result.length === 0) {
    return null;
  }

  return result[0];
}

/**
 * Create a new role
 */
export async function createRole(
  data: CreateRoleInput,
  operatorUserId: string,
  ipAddress?: string
) {
  // Validate input data
  const validatedData = createRoleSchema.parse(data);

  // Check if slug already exists (global uniqueness in single-user architecture)
  const existing = await db.query.roles.findFirst({
    where: eq(roles.slug, validatedData.slug),
  });

  if (existing) {
    throw new ConflictError('Role slug already exists', {
      slug: validatedData.slug,
      existingId: existing.id,
    });
  }

  const insertRole = async (database: Database) => {
    const [createdRole] = await database
      .insert(roles)
      .values({
        name: validatedData.name,
        slug: validatedData.slug,
        description: validatedData.description,
        permissions: validatedData.permissions,
        isDefault: validatedData.isDefault || false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return createdRole;
  };

  // Create role
  const newRole = validatedData.isDefault
    ? await withSystemContext(async (database) => {
        await clearOtherDefaultRoles(database);
        return insertRole(database);
      })
    : await insertRole(db);

  // Log audit trail
  await auditLogDurable({
    userId: operatorUserId,
    action: AUDIT_ACTIONS.ROLE_CREATE,
    resource: 'role',
    resourceId: newRole.id,
    resourceName: newRole.name,
    status: 'success',
    ipAddress,
    metadata: {
      role: {
        name: newRole.name,
        slug: newRole.slug,
        permissionCount: newRole.permissions.length,
      },
    },
  });

  return newRole;
}

/**
 * Update role information
 */
export async function updateRole(
  roleId: string,
  data: UpdateRoleInput,
  operatorUserId: string,
  ipAddress?: string
) {
  // Validate input data
  const validatedData = updateRoleSchema.parse(data);

  const existingRole = await db.query.roles.findFirst({
    where: eq(roles.id, roleId),
  });

  if (!existingRole) {
    throw new NotFoundError('Role', roleId);
  }

  // If slug is being changed, check for conflicts (global uniqueness)
  if (validatedData.slug && validatedData.slug !== existingRole.slug) {
    const slugExists = await db.query.roles.findFirst({
      where: eq(roles.slug, validatedData.slug),
    });

    if (slugExists) {
      throw new ConflictError('Role slug already exists', {
        slug: validatedData.slug,
        existingId: slugExists.id,
      });
    }
  }

  const updateRoleRecord = async (database: Database) => {
    const [role] = await database
      .update(roles)
      .set({
        ...validatedData,
        updatedAt: new Date(),
      })
      .where(eq(roles.id, roleId))
      .returning();

    return role;
  };

  // Update role
  const updatedRole = validatedData.isDefault
    ? await withSystemContext(async (database) => {
        await clearOtherDefaultRoles(database, roleId);
        return updateRoleRecord(database);
      })
    : await updateRoleRecord(db);

  // Log audit trail
  await auditLogDurable({
    userId: operatorUserId,
    action: AUDIT_ACTIONS.ROLE_UPDATE,
    resource: 'role',
    resourceId: roleId,
    resourceName: updatedRole.name,
    status: 'success',
    ipAddress,
    metadata: {
      changes: validatedData,
      previousValues: {
        name: existingRole.name,
        slug: existingRole.slug,
        permissions: existingRole.permissions,
      },
    },
  });

  // Invalidate cache for all users with this role
  const usersWithRole = await db
    .select({ userId: userroles.userId })
    .from(userroles)
    .where(eq(userroles.roleId, roleId));

  const affectedUserIds = usersWithRole.map((r) => r.userId);
  if (affectedUserIds.length > 0) {
    invalidateUserRoleCacheBatch(affectedUserIds);
  }

  return updatedRole;
}

/**
 * Delete role
 */
export async function deleteRole(roleId: string, operatorUserId: string, ipAddress?: string) {
  const role = await db.query.roles.findFirst({
    where: eq(roles.id, roleId),
  });

  if (!role) {
    throw new NotFoundError('Role', roleId);
  }

  // Prevent deleting default roles
  if (role.isDefault) {
    throw new ForbiddenError('Cannot delete default roles', {
      roleId,
      isDefault: true,
    });
  }

  // Check if role is assigned to any users
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(userroles)
    .where(eq(userroles.roleId, roleId));

  const assignedCount = Number(countResult[0]?.count || 0);

  if (assignedCount > 0) {
    throw new ConflictError(`Cannot delete role: assigned to ${assignedCount} users`, {
      roleId,
      assignedUserCount: assignedCount,
    });
  }

  // Delete role
  await db.delete(roles).where(eq(roles.id, roleId));

  // Log audit trail
  await auditLogDurable({
    userId: operatorUserId,
    action: AUDIT_ACTIONS.ROLE_DELETE,
    resource: 'role',
    resourceId: roleId,
    resourceName: role.name,
    status: 'success',
    ipAddress,
    metadata: {
      deletedRole: {
        id: role.id,
        name: role.name,
        slug: role.slug,
      },
    },
  });

  return { success: true };
}

/**
 * Assign role to user
 *
 * IMPORTANT: Uses transaction to prevent TOCTOU race conditions
 * and atomic SQL operations for usage tracking
 */
export async function assignRoleToUser(
  userId: string,
  roleId: string,
  operatorUserId: string,
  ipAddress?: string,
  expiresAt?: Date
) {
  // Validate input data
  const validatedData = assignRoleSchema.parse({
    userId,
    roleId,

    expiresAt,
  });

  // Execute all checks and inserts in a transaction to prevent TOCTOU
  const result = await db.transaction(async (tx) => {
    // 1. Check if role exists
    const role = await tx.query.roles.findFirst({
      where: eq(roles.id, validatedData.roleId),
    });

    if (!role) {
      throw new NotFoundError('Role', validatedData.roleId);
    }

    // 2. Check if assignment already exists
    const existing = await tx.query.userroles.findFirst({
      where: and(
        eq(userroles.userId, validatedData.userId),
        eq(userroles.roleId, validatedData.roleId)
      ),
    });

    if (existing) {
      throw new ConflictError('Role already assigned to user', {
        userId: validatedData.userId,
        roleId: validatedData.roleId,
      });
    }

    // 3. Check if user already has any roles
    const existingRoles = await tx.query.userroles.findMany({
      where: eq(userroles.userId, validatedData.userId),
    });

    const isFirstRole = existingRoles.length === 0;

    // Simplified 2-role system: Each user can only have ONE role (admin or user)
    // Features are controlled by subscription plans, not roles
    // If user needs role change, revoke existing role first
    if (!isFirstRole) {
      throw new ConflictError('User already has a role assigned', {
        userId: validatedData.userId,
        existingRoles: existingRoles.map((r) => r.roleId),
        message: 'Please revoke existing role before assigning a new one',
      });
    }

    // 4. Create role assignment
    const [assignment] = await tx
      .insert(userroles)
      .values({
        userId: validatedData.userId,
        roleId: validatedData.roleId,
        grantedBy: operatorUserId,
        grantedAt: new Date(),
        expiresAt: validatedData.expiresAt || null,
      })
      .returning();

    return {
      assignment,
      role,
      isFirstRole,
    };
  });

  // Log audit trail (outside transaction for better performance)
  // Note: auditLog is now async (fire-and-forget), error handling is internal
  await auditLogDurable({
    userId: operatorUserId,
    action: AUDIT_ACTIONS.ROLE_ASSIGN,
    resource: 'user_role',
    resourceId: result.assignment.id,
    status: 'success',
    ipAddress,
    metadata: {
      assignment: {
        userId: validatedData.userId,
        roleId: validatedData.roleId,
        roleName: result.role.name,
        isFirstRole: result.isFirstRole,
      },
    },
  });

  // Invalidate user cache
  invalidateUserRoleCache(validatedData.userId);

  return result.assignment;
}

/**
 * Revoke role from user
 *
 * IMPORTANT: Uses transaction to prevent TOCTOU race conditions
 * and atomic SQL operations for usage tracking
 */
export async function revokeRoleFromUser(
  userId: string,
  roleId: string,
  operatorUserId: string,
  ipAddress?: string
) {
  // Validate input data
  const validatedData = assignRoleSchema.parse({
    userId,
    roleId,
  });

  // Execute all checks and deletes in a transaction to prevent TOCTOU
  const result = await db.transaction(async (tx) => {
    // 1. Check if assignment exists
    const assignment = await tx.query.userroles.findFirst({
      where: and(
        eq(userroles.userId, validatedData.userId),
        eq(userroles.roleId, validatedData.roleId)
      ),
    });

    if (!assignment) {
      throw new NotFoundError(
        'Role assignment',
        `userId:${validatedData.userId}, roleId:${validatedData.roleId}`
      );
    }

    // 2. Check if this is the user's last role
    const allUserRoles = await tx.query.userroles.findMany({
      where: eq(userroles.userId, validatedData.userId),
    });

    const isLastRole = allUserRoles.length === 1;

    // 3. Delete role assignment
    await tx
      .delete(userroles)
      .where(
        and(eq(userroles.userId, validatedData.userId), eq(userroles.roleId, validatedData.roleId))
      );

    return {
      assignment,
      isLastRole,
    };
  });

  // Log audit trail (outside transaction for better performance)
  // Note: auditLog is now async (fire-and-forget), error handling is internal
  await auditLogDurable({
    userId: operatorUserId,
    action: AUDIT_ACTIONS.ROLE_REVOKE,
    resource: 'user_role',
    resourceId: result.assignment.id,
    status: 'success',
    ipAddress,
    metadata: {
      revocation: {
        userId: validatedData.userId,
        roleId: validatedData.roleId,
        isLastRole: result.isLastRole,
      },
    },
  });

  // Invalidate user cache
  invalidateUserRoleCache(validatedData.userId);

  return { success: true };
}

/**
 * Get user roles with full details
 *
 * Returns detailed role information including permissions, grant date, and expiry.
 * Filters out expired roles automatically.
 *
 * Note: For simple role slug checks with caching, use getUserRoles()
 * from '@/lib/auth/permissions' instead.
 *
 * @param userId - User ID
 * @param includeExpired - If true, include expired roles (default: false)
 * @returns Array of role details
 */
export async function getUserRoles(userId: string, includeExpired = false) {
  const conditions = [eq(userroles.userId, userId)];

  // Filter out expired roles unless explicitly requested
  if (!includeExpired) {
    conditions.push(or(isNull(userroles.expiresAt), gt(userroles.expiresAt, new Date()))!);
  }

  const userrolesList = await db
    .select({
      roleId: userroles.roleId,
      roleName: roles.name,
      roleSlug: roles.slug,
      permissions: roles.permissions,
      grantedAt: userroles.grantedAt,
      expiresAt: userroles.expiresAt,
    })
    .from(userroles)
    .innerJoin(roles, eq(userroles.roleId, roles.id))
    .where(and(...conditions));

  return userrolesList;
}

// NOTE: getUserPermissions and userHasPermission have been moved to
// src/lib/auth/permissions.ts which provides:
// - Caching (15-minute TTL)
// - Role expiry checking
// - Wildcard permission matching
// Use hasPermission() from '@/lib/auth/permissions' for permission checks

/**
 * Get role statistics
 *
 * @returns Role statistics including total roles and assignments
 */
export async function getRoleStats() {
  // Total roles
  const totalResult = await db.select({ count: sql<number>`count(*)` }).from(roles);
  const total = Number(totalResult[0]?.count || 0);

  // Total role assignments (only non-expired)
  const assignmentsResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(userroles)
    .where(or(isNull(userroles.expiresAt), gt(userroles.expiresAt, new Date())));
  const assigned = Number(assignmentsResult[0]?.count || 0);

  return {
    total,
    assigned,
  };
}
