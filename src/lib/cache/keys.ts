/**
 * Cache Key Management
 *
 * Type-safe cache key generators for consistent key naming across the application.
 *
 * @example
 * ```typescript
 * import { CACHE_KEYS } from '@/lib/cache';
 *
 * // Get user roles cache key
 * const key = CACHE_KEYS.user.roles(userId);
 *
 * // Get plugin settings cache key
 * const key = CACHE_KEYS.plugin.settings(pluginId, userId, 'theme');
 * ```
 */

// =============================================================================
// Cache Key Generators
// =============================================================================

/**
 * Type-safe cache key generators
 *
 * All cache keys follow the pattern: `namespace:identifier[:subidentifier]`
 */
export const CACHE_KEYS = {
  /**
   * User-related cache keys
   */
  user: {
    /** User basic info cache key */
    info: (userId: string): string => `user:${userId}`,

    /** User roles list cache key */
    roles: (userId: string): string => `roles:${userId}`,

    /** User permissions list cache key */
    permissions: (userId: string): string => `permissions:${userId}`,

    /** User entitlement/subscription cache key */
    entitlement: (userId: string): string => `entitlement:${userId}`,
  },

  /**
   * Plugin-related cache keys
   */
  plugin: {
    /** Plugin runtime contract cache key */
    contract: (pluginId: string): string => `plugin-contract:${pluginId}`,

    /** Plugin settings cache key (per user, per key) */
    settings: (pluginId: string, userId: string, key: string): string =>
      `settings:${pluginId}:${userId}:${key}`,

    /** Plugin settings prefix (for batch invalidation) */
    settingsPrefix: (pluginId: string, userId: string): string => `settings:${pluginId}:${userId}:`,
  },

  /**
   * Plan-related cache keys
   */
  plan: {
    /** Single plan cache key */
    single: (planId: string): string => `plan:${planId}`,

    /** All plans list cache key */
    all: (): string => 'plans:all',
  },
} as const;
