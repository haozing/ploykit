/**
 * Unified Cache Manager
 *
 * Provides LRU caching with TTL support for the application.
 */

import { logger } from '@/lib/_core/logger';
import { CACHE_TTL } from '@/lib/_core/constants';

// =============================================================================
// Types
// =============================================================================

/**
 * Cache type identifier
 */
export type CacheType = 'plugin-contract' | 'user' | 'custom';

/**
 * Cache configuration options
 */
export interface CacheConfig {
  /** Cache name (unique identifier) */
  name: string;

  /** Cache type for grouping */
  type: CacheType;

  /** Maximum entries (LRU eviction when exceeded) */
  maxSize?: number;

  /** Time-to-live in milliseconds (0 = never expires) */
  ttl?: number;

  /** Enable statistics tracking */
  enableStats?: boolean;
}

/**
 * Internal cache entry structure
 */
interface CacheEntry<T> {
  value: T;
  createdAt: number;
  accessedAt: number;
  ttl?: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  name: string;
  type: CacheType;
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  hitRate: number;
  evictions: number;
}

// =============================================================================
// LRU Cache Implementation
// =============================================================================

/**
 * LRU Cache with TTL support
 *
 * Uses JavaScript Map's insertion order to maintain LRU ordering.
 * First entry in the Map is the least recently used.
 */
class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private config: Required<CacheConfig>;
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(config: CacheConfig) {
    this.config = {
      name: config.name,
      type: config.type,
      maxSize: config.maxSize || 100,
      ttl: config.ttl || 0,
      enableStats: config.enableStats ?? true,
    };

    logger.debug(
      { name: config.name, maxSize: this.config.maxSize, ttl: this.config.ttl },
      'LRU cache initialized'
    );
  }

  /**
   * Get value from cache
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.stats.misses++;
      return undefined;
    }

    // Update access time and move to end (most recently used)
    entry.accessedAt = Date.now();

    // Move to end of Map to maintain LRU order
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.stats.hits++;
    return entry.value;
  }

  /**
   * Set value in cache
   */
  set(key: string, value: T, ttl?: number): void {
    // Check if we need to evict (only if key doesn't exist)
    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
        this.stats.evictions++;
        logger.debug(
          { cache: this.config.name, evictedKey: firstKey },
          'Cache entry evicted (LRU)'
        );
      }
    }

    const entry: CacheEntry<T> = {
      value,
      createdAt: Date.now(),
      accessedAt: Date.now(),
      ttl: ttl ?? this.config.ttl,
    };

    // Delete first to ensure entry moves to end (most recently used position)
    this.cache.delete(key);
    this.cache.set(key, entry);

    logger.debug({ cache: this.config.name, key, size: this.cache.size }, 'Cache entry set');
  }

  /**
   * Delete value from cache
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      logger.debug({ cache: this.config.name, key }, 'Cache entry deleted');
    }
    return deleted;
  }

  /**
   * Check if key exists in cache (and is not expired)
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Clear all entries from cache
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    logger.info({ cache: this.config.name, clearedEntries: size }, 'Cache cleared');
  }

  /**
   * Get all valid (non-expired) keys
   */
  keys(): string[] {
    const validKeys: string[] = [];
    for (const [key, entry] of this.cache.entries()) {
      if (!this.isExpired(entry)) {
        validKeys.push(key);
      } else {
        this.cache.delete(key);
      }
    }
    return validKeys;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const hitRate =
      this.stats.hits + this.stats.misses > 0
        ? this.stats.hits / (this.stats.hits + this.stats.misses)
        : 0;

    return {
      name: this.config.name,
      type: this.config.type,
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate,
      evictions: this.stats.evictions,
    };
  }

  /**
   * Reset statistics counters
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
    };
  }

  /**
   * Check if entry has expired
   */
  private isExpired(entry: CacheEntry<T>): boolean {
    if (!entry.ttl || entry.ttl === 0) return false;
    return Date.now() - entry.createdAt > entry.ttl;
  }

  /**
   * Remove all expired entries
   */
  cleanup(): number {
    let cleaned = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.debug({ cache: this.config.name, cleaned }, 'Expired entries cleaned');
    }
    return cleaned;
  }
}

// =============================================================================
// Cache Manager
// =============================================================================

/**
 * Central cache manager
 *
 * Manages multiple LRU cache instances and provides:
 * - Cache registration and lifecycle management
 * - Periodic cleanup of expired entries
 * - Statistics aggregation
 */
export class CacheManager {
  private caches = new Map<string, LRUCache<unknown>>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupAllCaches();
      },
      5 * 60 * 1000
    );

    logger.debug('CacheManager initialized');
  }

  /**
   * Register a new cache instance
   */
  registerCache<T>(config: CacheConfig): LRUCache<T> {
    // Idempotent: return existing cache silently (supports multi-bundle loading)
    if (this.caches.has(config.name)) {
      return this.caches.get(config.name)! as LRUCache<T>;
    }

    const cache = new LRUCache<T>(config);
    this.caches.set(config.name, cache as LRUCache<unknown>);

    logger.debug(
      { name: config.name, type: config.type, maxSize: config.maxSize },
      'Cache registered'
    );

    return cache;
  }

  /**
   * Get a registered cache instance
   */
  getCache<T>(name: string): LRUCache<T> | undefined {
    return this.caches.get(name) as LRUCache<T> | undefined;
  }

  /**
   * Unregister and clear a cache
   */
  unregisterCache(name: string): boolean {
    const cache = this.caches.get(name);
    if (cache) {
      cache.clear();
      this.caches.delete(name);
      logger.info({ name }, 'Cache unregistered');
      return true;
    }
    return false;
  }

  /**
   * Clear all registered caches
   */
  clearAll(): void {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
    logger.warn('All caches cleared');
  }

  /**
   * Clear all caches of a specific type
   */
  clearByType(type: CacheType): void {
    for (const cache of this.caches.values()) {
      if (cache.getStats().type === type) {
        cache.clear();
      }
    }
    logger.info({ type }, 'Caches cleared by type');
  }

  /**
   * Invalidate entries by key prefix
   */
  invalidateByPrefix(cacheName: string, prefix: string): number {
    const cache = this.caches.get(cacheName);
    if (!cache) return 0;

    let invalidated = 0;
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) {
        cache.delete(key);
        invalidated++;
      }
    }

    logger.info({ cacheName, prefix, invalidated }, 'Cache entries invalidated by prefix');
    return invalidated;
  }

  /**
   * Get statistics for all caches
   */
  getAllStats(): CacheStats[] {
    const stats: CacheStats[] = [];
    for (const cache of this.caches.values()) {
      stats.push(cache.getStats());
    }
    return stats;
  }

  /**
   * Get statistics for a specific cache
   */
  getStats(name: string): CacheStats | undefined {
    const cache = this.caches.get(name);
    return cache?.getStats();
  }

  /**
   * Clean up expired entries from all caches
   */
  private cleanupAllCaches(): void {
    let totalCleaned = 0;
    for (const cache of this.caches.values()) {
      totalCleaned += cache.cleanup();
    }
    if (totalCleaned > 0) {
      logger.info({ totalCleaned }, 'Expired cache entries cleaned');
    }
  }

  /**
   * Destroy the cache manager and clear all caches
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clearAll();
    logger.info('CacheManager destroyed');
  }
}

// =============================================================================
// Global Instance (with HMR support)
// =============================================================================

/**
 * Global type declaration for HMR persistence
 */
declare global {
  var __cacheManager: CacheManager | undefined;
}

/**
 * Global cache manager instance
 *
 * Uses globalThis to persist across HMR in development mode.
 * Reuses existing instance to preserve cached data across webpack bundle loads.
 */
if (!globalThis.__cacheManager) {
  globalThis.__cacheManager = new CacheManager();
}

export const cacheManager = globalThis.__cacheManager;

// =============================================================================
// Predefined Cache Instances
// =============================================================================

/**
 * Plugin runtime contract cache
 *
 * Caches normalized plugin runtime contracts for quick access.
 * TTL is 0 (never expires) because plugin.ts contracts are managed by HMR in development.
 *
 * Used by: runtime plugin contract loading.
 */
export const pluginContractCache = cacheManager.registerCache<Record<string, unknown>>({
  name: 'plugin-contract',
  type: 'plugin-contract',
  maxSize: 50,
  ttl: CACHE_TTL.PLUGIN_CONTRACT_SECONDS * 1000,
});

/**
 * User roles cache
 *
 * Caches user role assignments (array of role slugs per user).
 *
 * Read by: getUserRoles(userId)
 * Invalidated by: assignRole(), removeRole()
 */
export const userRoleCache = cacheManager.registerCache<string[]>({
  name: 'user-roles',
  type: 'user',
  maxSize: 5000,
  ttl: CACHE_TTL.USER_ROLES_SECONDS * 1000,
});

/**
 * User permissions cache
 *
 * Caches computed user permissions (array of permission strings).
 *
 * Read by: getUserPermissions(userId)
 * Invalidated by: assignRole(), removeRole() (permissions derived from roles)
 */
export const userPermissionCache = cacheManager.registerCache<string[]>({
  name: 'user-permissions',
  type: 'user',
  maxSize: 5000,
  ttl: CACHE_TTL.USER_PERMISSIONS_SECONDS * 1000,
});

/**
 * User entitlement cache
 *
 * Caches user subscription/entitlement data including plan details.
 *
 * Read by: getUserEntitlement(userId), getUserPlan(userId)
 * Invalidated by: createUserEntitlement(), upgradeUserPlan(), cancelSubscription()
 */
export const userEntitlementCache = cacheManager.registerCache<Record<string, unknown>>({
  name: 'user-entitlements',
  type: 'user',
  maxSize: 5000,
  ttl: CACHE_TTL.USER_ENTITLEMENT_SECONDS * 1000,
});

/**
 * Plugin settings cache
 *
 * Caches per-user plugin settings for quick access.
 *
 * Read by: settings.get(key)
 * Invalidated by: settings.set(key, value), settings.delete(key)
 */
export const pluginSettingsCache = cacheManager.registerCache<unknown>({
  name: 'plugin-settings',
  type: 'user',
  maxSize: 10000,
  ttl: CACHE_TTL.PLUGIN_SETTINGS_SECONDS * 1000,
});
