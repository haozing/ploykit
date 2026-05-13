/**
 * Cache Invalidation Helpers
 *
 *
 */

import { logger } from '@/lib/_core/logger';
import { userRoleCache, userPermissionCache, userEntitlementCache } from './cache-manager';
import { CACHE_KEYS } from './keys';

/**
 *
 * - assignroleTouser(userId, roleId) - assignrole
 * - revokeroleFromuser(userId, roleId) - Undorole
 *
 * @param userId - userID
 *
 * @example
 * ```typescript
 * await assignroleTouser(userId, roleId);
 * invalidateuserroleCache(userId);
 * ```
 */
export function invalidateUserRoleCache(userId: string): void {
  try {
    userRoleCache.delete(CACHE_KEYS.user.roles(userId));
    userPermissionCache.delete(CACHE_KEYS.user.permissions(userId));

    logger.debug({ userId }, 'Invalidated user role/permission cache');
  } catch (error) {
    logger.error({ userId, error }, 'Failed to invalidate user role cache (non-critical)');
  }
}

/**
 *
 *
 *
 * @example
 * ```typescript
 * const usersWithrole = await getusersWithrole(roleId);
 * await updaterole(roleId, updates);
 * invalidateuserroleCacheBatch(usersWithrole.map(u => u.userId));
 * ```
 */
export function invalidateUserRoleCacheBatch(userIds: string[]): void {
  try {
    for (const userId of userIds) {
      userRoleCache.delete(CACHE_KEYS.user.roles(userId));
      userPermissionCache.delete(CACHE_KEYS.user.permissions(userId));
    }

    logger.info({ count: userIds.length }, 'Invalidated user role/permission cache (batch)');
  } catch (error) {
    logger.error(
      { count: userIds.length, error },
      'Failed to invalidate user role cache batch (non-critical)'
    );
  }
}

/**
 *
 * - createUserEntitlement(userId) - Createentitlement
 * - cancelSubscription(userId) - CancelSubscribe
 *
 * @param userId - userID
 *
 * @example
 * ```typescript
 * // ?
 * await upgradeUserPlan(userId, newPlanId);
 * invalidateuserEntitlementCache(userId);
 * ```
 */
export function invalidateUserEntitlementCache(userId: string): void {
  try {
    userEntitlementCache.delete(CACHE_KEYS.user.entitlement(userId));

    logger.debug({ userId }, 'Invalidated user entitlement cache');
  } catch (error) {
    logger.error({ userId, error }, 'Failed to invalidate user entitlement cache (non-critical)');
  }
}

/**
 *
 *
 *
 * @example
 * ```typescript
 * await runDataMigration();
 * invalidateAlluserCaches();
 * ```
 */
export function invalidateAllUserCaches(): void {
  try {
    userRoleCache.clear();
    userPermissionCache.clear();
    userEntitlementCache.clear();

    logger.warn('Invalidated all user caches');
  } catch (error) {
    logger.error({ error }, 'Failed to invalidate all user caches (critical)');
  }
}

/**
 *
 * - userDelete
 *
 * @param userId - userID
 *
 * @example
 * ```typescript
 * invalidateAlluserCachesByuserId(userId);
 * await deleteuser(userId);
 * ```
 */
export function invalidateAllUserCachesByUserId(userId: string): void {
  try {
    invalidateUserRoleCache(userId);
    invalidateUserEntitlementCache(userId);

    logger.info({ userId }, 'Invalidated all caches for user');
  } catch (error) {
    logger.error({ userId, error }, 'Failed to invalidate all user caches (non-critical)');
  }
}
