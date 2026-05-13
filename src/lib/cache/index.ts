/**
 * Cache Exports
 *
 * Unified cache module providing:
 * - LRU cache manager with TTL support
 * - Pre-configured cache instances for common use cases
 * - Cache key generators for type-safe key management
 * - Cache invalidation helpers
 * - Cache warmup utilities
 */

// Core cache manager and instances
export {
  CacheManager,
  cacheManager,
  pluginContractCache,
  userRoleCache,
  userPermissionCache,
  userEntitlementCache,
  pluginSettingsCache,
  type CacheType,
  type CacheConfig,
  type CacheStats,
} from './cache-manager';

// Cache key management
export { CACHE_KEYS } from './keys';
export type * from './keys';

// Cache invalidation helpers
export {
  invalidateUserRoleCache,
  invalidateUserRoleCacheBatch,
  invalidateUserEntitlementCache,
  invalidateAllUserCaches,
  invalidateAllUserCachesByUserId,
} from './invalidation';

// Cache warmup utilities
export { warmupCaches } from './cache-warmup';
