/**
 * Permission System
 *
 * Simplified global permission checking for tool site
 *
 * Responsibilities:
 * - Check user roles (admin, user)
 * - Verify permissions
 * - Provide helper functions for common permission checks
 *
 * Note: Feature permissions (API access, webhooks, premium tools, etc.)
 * are now controlled by subscription plans, not roles.
 * Use user-entitlement-service.ts for feature checks.
 *
 * Improvements: Added complete logging and unified error handling
 */

import { db } from '@/lib/db';
import { userroles, roles } from '@/lib/db/schema';
import { eq, and, or, isNull, gt } from 'drizzle-orm';
import {
  userRoleCache,
  userPermissionCache,
  CACHE_KEYS,
  invalidateUserRoleCache,
} from '@/lib/cache';
import { logger } from '@/lib/_core/logger';
import { NotFoundError } from '@/lib/_core/errors';
import {
  normalizePermissionIdentifier,
  permissionMatches,
} from '@/lib/services/rbac/permission-service';

// Role Constants

/**
 * Available system roles
 *
 * Only two roles in tool site:
 * - admin: System administrators
 * - user: Regular users
 */
export const ROLE_SLUGS = {
  ADMIN: 'admin',
  USER: 'user',
} as const;

export type RoleSlug = (typeof ROLE_SLUGS)[keyof typeof ROLE_SLUGS];

// Permission Constants

/**
 * System permissions
 *
 * These are role-based permissions for system administration.
 * Feature permissions (API, webhooks, tools, etc.) are controlled by
 * subscription plans - see user-entitlement-service.ts
 */
export const PERMISSIONS = {
  // Admin permissions (system management)
  ADMIN_ACCESS: 'admin:access:all',
  USER_MANAGE: 'user:manage:all',
  ROLE_MANAGE: 'role:manage:all',
  PLAN_MANAGE: 'plan:manage:all',
  SYSTEM_CONFIG: 'system:config:all',

  // Basic user permissions (account management)
  PROFILE_EDIT: 'profile:edit:self',
  PROFILE_VIEW: 'profile:view:self',
  ACCOUNT_MANAGE: 'account:manage:self',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Role Queries

/**
 * Get all roles for a user
 *
 * Cached for 15 minutes
 *
 * @param userId - User ID
 * @returns Array of role slugs
 */
export async function getUserRoles(userId: string): Promise<string[]> {
  // Check cache
  const cacheKey = CACHE_KEYS.user.roles(userId);
  const cached = userRoleCache.get(cacheKey);
  if (cached) {
    logger.debug({ userId, roles: cached }, 'User roles fetched from cache');
    return cached;
  }

  // Query database - only include non-expired roles
  const userRolesList = await db
    .select({
      roleSlug: roles.slug,
    })
    .from(userroles)
    .innerJoin(roles, eq(userroles.roleId, roles.id))
    .where(
      and(
        eq(userroles.userId, userId),
        // Only include roles that have no expiry or haven't expired yet
        or(isNull(userroles.expiresAt), gt(userroles.expiresAt, new Date()))
      )
    );

  const rolesList = userRolesList.map((r) => r.roleSlug);

  logger.debug({ userId, roles: rolesList }, 'User roles fetched from database');

  // Write to cache
  userRoleCache.set(cacheKey, rolesList);

  return rolesList;
}

/**
 * Get user's primary role
 *
 * Priority: admin > user
 *
 * @param userId - User ID
 * @returns Primary role slug, or null if user has no roles
 */
export async function getUserRole(userId: string): Promise<RoleSlug | null> {
  const rolesList = await getUserRoles(userId);

  if (rolesList.includes(ROLE_SLUGS.ADMIN)) return ROLE_SLUGS.ADMIN;
  if (rolesList.includes(ROLE_SLUGS.USER)) return ROLE_SLUGS.USER;

  return null;
}

/**
 * Get all permissions for a user
 *
 * Combines permissions from all user's roles
 *
 * Cached for 15 minutes
 *
 * @param userId - User ID
 * @returns Array of permission strings
 */
export async function getUserPermissions(userId: string): Promise<string[]> {
  // Check cache
  const cacheKey = CACHE_KEYS.user.permissions(userId);
  const cached = userPermissionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Query database - only include non-expired roles
  const userRolesList = await db
    .select({
      permissions: roles.permissions,
    })
    .from(userroles)
    .innerJoin(roles, eq(userroles.roleId, roles.id))
    .where(
      and(
        eq(userroles.userId, userId),
        // Only include roles that have no expiry or haven't expired yet
        or(isNull(userroles.expiresAt), gt(userroles.expiresAt, new Date()))
      )
    );

  // Combine all permissions from all roles and deduplicate
  const allPermissions = userRolesList
    .flatMap((r) => r.permissions || [])
    .map(normalizePermissionIdentifier);
  const uniquePermissions = [...new Set(allPermissions)];

  // Write to cache
  userPermissionCache.set(cacheKey, uniquePermissions);

  return uniquePermissions;
}

// Role Checks

/**
 * Check if user is an admin
 *
 * Uses getUserRole() which already implements role priority logic
 *
 * @param userId - User ID
 * @returns True if user has admin role
 */
export async function isAdmin(userId: string): Promise<boolean> {
  const primaryRole = await getUserRole(userId);
  return primaryRole === ROLE_SLUGS.ADMIN;
}

/**
 * Check if user has a specific role
 *
 * @param userId - User ID
 * @param roleSlug - Role slug to check
 * @returns True if user has the role
 */
export async function hasRole(userId: string, roleSlug: string): Promise<boolean> {
  const rolesList = await getUserRoles(userId);
  return rolesList.includes(roleSlug);
}

// Permission Checks

/**
 * Check if user has a specific permission
 *
 * Supports wildcard matching:
 * - `*` in resource: All resources
 * - `*` in action: All actions
 * - `*` in scope: All scopes
 * - `*:*:*`: Full access (super admin)
 *
 * Type-safe: Only accepts known permission constants
 *
 * @param userId - User ID
 * @param permission - Permission constant from PERMISSIONS
 * @returns True if user has the permission (exact or wildcard match)
 */
export async function hasPermission(userId: string, permission: Permission): Promise<boolean> {
  const userPermissions = await getUserPermissions(userId);

  // Check for exact match first (most common case)
  if (userPermissions.includes(permission)) {
    return true;
  }

  // Check for wildcard matches
  return userPermissions.some((userPerm) => permissionMatches(userPerm, permission));
}

export async function hasPermissionIdentifier(
  userId: string,
  permission: string
): Promise<boolean> {
  const userPermissions = await getUserPermissions(userId);

  if (userPermissions.includes(permission)) {
    return true;
  }

  return userPermissions.some((userPerm) => permissionMatches(userPerm, permission));
}

/**
 * Check if a single permission is satisfied by user's permissions
 * Supports wildcard matching
 */
function checkPermissionMatch(userPermissions: string[], requiredPermission: string): boolean {
  if (userPermissions.includes(requiredPermission)) {
    return true;
  }
  return userPermissions.some((userPerm) => permissionMatches(userPerm, requiredPermission));
}

/**
 * Check if user has ALL of the specified permissions
 *
 * Supports wildcard matching for each permission check
 *
 * Type-safe: Only accepts known permission constants
 *
 * @param userId - User ID
 * @param requiredPermissions - Array of permission constants from PERMISSIONS
 * @returns True if user has all permissions
 */
export async function hasAllPermissions(
  userId: string,
  requiredPermissions: readonly Permission[]
): Promise<boolean> {
  const userPermissions = await getUserPermissions(userId);
  return requiredPermissions.every((p) => checkPermissionMatch(userPermissions, p));
}

/**
 * Check if user has ANY of the specified permissions
 *
 * Supports wildcard matching for each permission check
 *
 * Type-safe: Only accepts known permission constants
 *
 * @param userId - User ID
 * @param requiredPermissions - Array of permission constants from PERMISSIONS
 * @returns True if user has at least one permission
 */
export async function hasAnyPermission(
  userId: string,
  requiredPermissions: readonly Permission[]
): Promise<boolean> {
  const userPermissions = await getUserPermissions(userId);
  return requiredPermissions.some((p) => checkPermissionMatch(userPermissions, p));
}

// Common Permission Checks (System Administration)

/**
 * Check if user can access admin panel
 *
 * @param userId - User ID
 * @returns True if user has admin access
 */
export async function canAccessAdmin(userId: string): Promise<boolean> {
  return hasPermission(userId, PERMISSIONS.ADMIN_ACCESS);
}

/**
 * Check if user can manage other users
 *
 * @param userId - User ID
 * @returns True if user can manage users
 */
export async function canManageUsers(userId: string): Promise<boolean> {
  return hasPermission(userId, PERMISSIONS.USER_MANAGE);
}

/**
 * Check if user can manage roles
 *
 * @param userId - User ID
 * @returns True if user can manage roles
 */
export async function canManageRoles(userId: string): Promise<boolean> {
  return hasPermission(userId, PERMISSIONS.ROLE_MANAGE);
}

/**
 * Check if user can manage plans
 *
 * @param userId - User ID
 * @returns True if user can manage plans
 */
export async function canManagePlans(userId: string): Promise<boolean> {
  return hasPermission(userId, PERMISSIONS.PLAN_MANAGE);
}

// NOTE: Feature Permission Checks Moved
//
// The following functions have been moved to user-entitlement-service.ts
// because they are now controlled by subscription plans, not roles:
//
// - canUsePremiumTools()     -> see user-entitlement-service.ts
// - canInstallPlugin()       -> see user-entitlement-service.ts
// - canCreateWebhook()       -> see user-entitlement-service.ts
// - canCreateHook()          -> see user-entitlement-service.ts
// - canCallAPI()             -> see user-entitlement-service.ts
// - hasAPIAccess()           -> see user-entitlement-service.ts
// - hasAdvancedFeatures()    -> see user-entitlement-service.ts
// - hasPrioritySupport()     -> see user-entitlement-service.ts

// User Summary

/**
 * Get complete permission summary for a user
 *
 * Note: For feature permissions (API, webhooks, tools), use getUserEntitlement()
 * from user-entitlement-service.ts instead.
 *
 * @param userId - User ID
 * @returns Permission summary (system permissions only)
 */
export async function getUserPermissionSummary(userId: string) {
  const [rolesList, permissions, primaryRole] = await Promise.all([
    getUserRoles(userId),
    getUserPermissions(userId),
    getUserRole(userId),
  ]);

  return {
    userId,
    primaryRole,
    roles: rolesList,
    permissions,
    isAdmin: rolesList.includes(ROLE_SLUGS.ADMIN),
  };
}

// Role Assignment (Server-side only)

// Type for database client (global db or transaction)
type DatabaseClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Invalidate user role cache if not in transaction context
 *
 * When called within a transaction, cache invalidation should be deferred
 * until after the transaction commits to avoid cache inconsistency.
 *
 * @param userId - User ID to invalidate cache for
 * @param dbClient - If provided, assumes we're in transaction context and skips invalidation
 */
function invalidateCacheIfNotInTransaction(userId: string, dbClient?: DatabaseClient): void {
  if (!dbClient) {
    invalidateUserRoleCache(userId);
  }
}

/**
 * Assign a role to a user
 *
 * @param userId - User ID
 * @param roleSlug - Role slug
 * @param grantedBy - ID of user granting the role (optional)
 * @param dbClient - Database client or transaction object (optional, defaults to global db)
 */
export async function assignRole(
  userId: string,
  roleSlug: string,
  grantedBy?: string,
  dbClient?: DatabaseClient
): Promise<void> {
  logger.info({ userId, roleSlug, grantedBy }, 'Assigning role to user');

  // Use provided dbClient or fallback to global db
  const client = dbClient || db;

  // Find role by slug
  const role = await client.query.roles.findFirst({
    where: eq(roles.slug, roleSlug),
  });

  if (!role) {
    logger.error({ userId, roleSlug }, 'Role not found');
    throw new NotFoundError('Role', roleSlug);
  }

  // Check if user already has this role
  const existing = await client.query.userroles.findFirst({
    where: and(eq(userroles.userId, userId), eq(userroles.roleId, role.id)),
  });

  if (existing) {
    logger.debug({ userId, roleSlug }, 'User already has this role');
    return; // Already has role
  }

  // Assign role
  await client.insert(userroles).values({
    userId,
    roleId: role.id,
    grantedBy,
  });

  logger.info({ userId, roleSlug, roleId: role.id }, 'Role assigned successfully');

  // Invalidate user cache (skipped if in transaction context)
  invalidateCacheIfNotInTransaction(userId, dbClient);
}

/**
 * Remove a role from a user
 *
 * @param userId - User ID
 * @param roleSlug - Role slug
 * @param dbClient - Database client or transaction object (optional, defaults to global db)
 */
export async function removeRole(
  userId: string,
  roleSlug: string,
  dbClient?: DatabaseClient
): Promise<void> {
  logger.info({ userId, roleSlug }, 'Removing role from user');

  // Use provided dbClient or fallback to global db
  const client = dbClient || db;

  // Find role by slug
  const role = await client.query.roles.findFirst({
    where: eq(roles.slug, roleSlug),
  });

  if (!role) {
    logger.debug({ userId, roleSlug }, 'Role does not exist, nothing to remove');
    return; // Role doesn't exist, nothing to remove
  }

  // Remove role assignment
  await client
    .delete(userroles)
    .where(and(eq(userroles.userId, userId), eq(userroles.roleId, role.id)));

  logger.info({ userId, roleSlug, roleId: role.id }, 'Role removed successfully');

  // Invalidate user cache (skipped if in transaction context)
  invalidateCacheIfNotInTransaction(userId, dbClient);
}
