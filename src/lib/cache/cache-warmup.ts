/**
 * Cache Warmup Module
 *
 * Preloads frequently accessed data into cache on application startup
 * to improve initial request performance and reduce database load.
 *
 * Benefits:
 * - Faster first requests (no cache misses)
 * - Reduced database load during startup phase
 * - Better user experience for initial page loads
 */

import { db } from '@/lib/db';
import { roles, user } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getUserRoles } from '@/lib/auth/permissions';
import { logger } from '@/lib/_core/logger';

/**
 * Get list of recently active user IDs
 *
 * @param limit - Number of users to fetch (default: 100)
 * @returns Array of user IDs
 */
async function getRecentActiveUserIds(limit: number = 100): Promise<string[]> {
  const recentUsers = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.emailVerified, true))
    .orderBy(desc(user.updatedAt))
    .limit(limit);

  return recentUsers.map((u) => u.id);
}

/**
 * Warmup database connection pool
 *
 * Executes a simple query to ensure database connection is established
 * and connection pool is initialized before handling user requests.
 *
 * Note: This does NOT cache the roles themselves (they are system-level data
 * with their own caching strategy). It only warms up the database connection.
 */
async function warmupDatabaseConnection(): Promise<void> {
  try {
    logger.info('Warming up database connection...');

    // Execute simple queries to warm up connection pool
    const defaultRole = await db.query.roles.findFirst({
      where: eq(roles.isDefault, true),
    });

    if (defaultRole) {
      logger.debug({ roleSlug: defaultRole.slug }, 'Default role query successful');
    }

    // Query a small number of roles to ensure connection is fully established
    const allRoles = await db.query.roles.findMany({
      limit: 10,
    });

    logger.info({ roleCount: allRoles.length }, 'Database connection warmup completed');
  } catch (error) {
    logger.error({ error }, 'Database connection warmup failed');
  }
}

/**
 * Warmup user role cache
 *
 * Preloads roles for recently active users into the cache.
 * This ensures that the first requests from active users don't experience
 * cache misses for role data.
 *
 * @param limit - Number of users to warmup (default: 100)
 */
async function warmupUserRoleCache(limit: number = 100): Promise<void> {
  try {
    logger.info({ limit }, 'Starting user role cache warmup...');

    // Get recently active users
    const activeUserIds = await getRecentActiveUserIds(limit);

    if (activeUserIds.length === 0) {
      logger.info('No active users found for cache warmup');
      return;
    }

    // Preload roles for active users in batches
    const batchSize = 20;
    let warmedCount = 0;

    for (let i = 0; i < activeUserIds.length; i += batchSize) {
      const batch = activeUserIds.slice(i, i + batchSize);

      // Load roles in parallel for this batch
      await Promise.all(
        batch.map(async (userId) => {
          try {
            await getUserRoles(userId); // This will cache the result
            warmedCount++;
          } catch (error) {
            logger.debug({ userId, error }, 'Failed to warmup user role cache');
          }
        })
      );

      logger.debug(
        { progress: `${Math.min(i + batchSize, activeUserIds.length)}/${activeUserIds.length}` },
        'User role cache warmup progress'
      );
    }

    logger.info({ count: warmedCount }, 'User role cache warmup completed');
  } catch (error) {
    logger.error({ error }, 'User role cache warmup failed');
  }
}

/**
 * Warmup all caches
 *
 * Main entry point for cache warmup process.
 * Called during application initialization.
 *
 * This function:
 * 1. Warms up database connection pool
 * 2. Preloads user role data for recently active users
 *
 * Failures are logged but do not prevent application startup.
 */
export async function warmupCaches(): Promise<void> {
  const startTime = Date.now();
  logger.info('Starting cache warmup process...');

  try {
    // Run warmup operations in parallel
    await Promise.all([
      warmupDatabaseConnection(),
      warmupUserRoleCache(100), // Warmup top 100 active users
    ]);

    const duration = Date.now() - startTime;
    logger.info({ duration }, 'Cache warmup completed successfully');
  } catch (error) {
    logger.error({ error }, 'Cache warmup process failed');
    // Don't throw - warmup failure should not prevent app startup
  }
}
