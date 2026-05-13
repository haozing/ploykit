/**
 * Usage Tracker Helper (User-Level System)
 *
 * Updated: Fully migrated to user-level architecture
 *
 * This module provides wrapper functions for tracking user usage metrics.
 * All tracking is now handled by the user-entitlement-service.
 */

import { logger } from '@/lib/_core/logger';
import { trackMetric } from '@/lib/services/user/user-entitlement-service';

/**
 * Usage Metrics
 */
export enum UsageMetric {
  USERS = 'platform.users',
  STORAGE = 'platform.storageMB',
  API_CALLS = 'platform.apiCalls',
  PLUGINS = 'platform.plugins',
}

//
// User-Level Usage Tracking Functions
//

/**
 * Track API call for a user
 *
 * This is a named wrapper around user-entitlement-service.trackMetric().
 *
 * @param userId - User ID
 * @param count - Number of API calls (default: 1)
 *
 * @example
 * ```typescript
 * await trackApiCall(userId);
 * ```
 */
export async function trackApiCall(userId: string, count: number = 1): Promise<void> {
  if (!userId) {
    logger.warn('trackApiCall called with empty userId');
    return;
  }

  try {
    await trackMetric(userId, UsageMetric.API_CALLS, count);
  } catch (error) {
    logger.error({ error, userId }, 'Failed to track API call');
    // Don't throw - tracking failures should not break the request
  }
}
