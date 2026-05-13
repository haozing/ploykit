/**
 * Entitlements General Type Definitions (Framework Level)
 *
 * v3.0 Design Principles:
 * - System layer doesn't know specific quota field names
 * - Use generic string types, support any plugin
 * - Plugin layer can define their own type-safe wrappers
 */

export interface RecordUsageOptions {
  /** User ID */
  userId: string;

  /** Subscription record ID */
  entitlementId: string;

  /**
   * Quota metric name (dot-scoped string)
   *
   * Examples:
   * - Platform: 'platform.apiCalls', 'platform.storageBytes'
   * - Runlynk: 'runlynk.jobExecutionsPerMonth', 'runlynk.concurrentJobs'
   * - Other plugins: 'seo-plus.auditRuns', 'video-tools.minutes'
   */
  metric: string;

  /**
   * Delta (can be negative)
   *
   * - Positive: Increase usage (e.g., execute job +1)
   * - Negative: Decrease usage (e.g., release concurrent slot -1)
   * - Zero: Don't change usage (only update metadata)
   */
  delta: number;

  /**
   * Optional metadata
   *
   * Used to store additional information, e.g.:
   * - jobId: Associated job ID
   * - timestamp: Operation timestamp
   * - ipAddress: User IP address
   */
  metadata?: Record<string, unknown>;
}

/**
 * Record usage result
 */
export interface RecordUsageResult {
  /** Whether successful */
  success: boolean;

  /** Updated value */
  newValue: number;

  /** Quota metric name */
  metric: string;
}

/**
 * Reset usage options (framework-level generic)
 *
 * Should be executed periodically by Cron Job (specific cycle decided by plugin)
 *
 * @example Runlynk plugin: Reset all users' monthly execution count
 * ```typescript
 * await resetUsage({
 *   metric: 'runlynk.jobExecutionsPerMonth',
 *   value: 0
 * })
 * ```
 *
 * @example Other plugin: Reset daily API call count
 * ```typescript
 * await resetUsage({
 *   metric: 'platform.apiCallsPerDay',
 *   value: 0
 * })
 * ```
 *
 * @example Only reset users of specific plan
 * ```typescript
 * await resetUsage({
 *   metric: 'runlynk.jobExecutionsPerMonth',
 *   value: 0,
 *   planId: 'plan-uuid'
 * })
 * ```
 */
export interface ResetUsageOptions {
  /**
   * Quota metric name (dot-scoped string)
   *
   * Examples:
   * - Platform: 'platform.apiCalls'
   * - Runlynk: 'runlynk.jobExecutionsPerMonth'
   * - Other plugins: 'video-tools.minutes'
   */
  metric: string;

  /**
   * Reset to value (default 0)
   *
   * Most cases reset to 0, but can also reset to other values
   */
  value?: number;

  /**
   * Optional: Only reset users of specific plan
   *
   * If not provided, reset all users
   */
  planId?: string;
}
