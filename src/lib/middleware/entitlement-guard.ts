/**
 * Entitlement Guard Middleware
 *
 * Provides functions to check entitlement limits and feature access
 * Used before operations to ensure user has permission and capacity
 */

import {
  getUserEntitlement,
  hasFeature,
  canCallAPI as checkCanCallAPI,
  canInstallPlugin as checkCanInstallPlugin,
  getRemainingQuota,
  readEffectivePlanLimits,
} from '@/lib/services/user/user-entitlement-service';
import {
  StorageLimitExceededError,
  RateLimitExceededError,
  FeatureNotAvailableError,
  SubscriptionInactiveError,
  EntitlementError,
} from '@/lib/_core/errors';

/**
 * Check if user can install more plugins
 */
export async function canInstallPlugin(userId: string): Promise<void> {
  const allowed = await checkCanInstallPlugin(userId);

  if (!allowed) {
    throw new EntitlementError(
      `Plugin limit reached or feature not available`,
      'PLUGIN_LIMIT_EXCEEDED',
      {}
    );
  }
}

/**
 * Check if user can use more storage
 */
export async function canUseStorage(userId: string, additionalMB: number): Promise<void> {
  const remaining = await getRemainingQuota(
    userId,
    'platform.storageBytes',
    'platform.storageBytes'
  );
  const additionalBytes = additionalMB * 1024 * 1024;

  // If unlimited, allow
  if (remaining === -1) {
    return;
  }

  if (additionalBytes > remaining) {
    throw new StorageLimitExceededError(0, 0, additionalMB);
  }
}

/**
 * Check if user can make more API calls
 */
export async function canMakeApiCall(userId: string): Promise<void> {
  const allowed = await checkCanCallAPI(userId);

  if (!allowed) {
    throw new RateLimitExceededError(0, 0);
  }
}

/**
 * Check if user has access to a feature
 */
export async function requireFeature(userId: string, featureName: string): Promise<void> {
  const hasAccess = await hasFeature(userId, featureName);

  if (!hasAccess) {
    const entitlement = await getUserEntitlement(userId);
    const planName = entitlement?.plan?.name || 'current plan';

    throw new FeatureNotAvailableError(featureName, planName);
  }
}

/**
 * Check multiple feature requirements
 */
export async function requireFeatures(userId: string, featureNames: string[]): Promise<void> {
  for (const featureName of featureNames) {
    await requireFeature(userId, featureName);
  }
}

/**
 * Get user entitlement status
 */
export async function checkEntitlementStatus(userId: string): Promise<{
  isActive: boolean;
  plan: string;
  message?: string;
}> {
  const entitlement = await getUserEntitlement(userId);

  if (!entitlement) {
    return {
      isActive: false,
      plan: 'none',
      message: 'No entitlement found for this user',
    };
  }

  if (entitlement.status !== 'active') {
    return {
      isActive: false,
      plan: entitlement.plan?.name || 'unknown',
      message: `Subscription is ${entitlement.status}`,
    };
  }

  // Check if subscription has expired
  if (entitlement.endDate && new Date(entitlement.endDate) < new Date()) {
    return {
      isActive: false,
      plan: entitlement.plan?.name || 'unknown',
      message: 'Subscription has expired',
    };
  }

  return {
    isActive: true,
    plan: entitlement.plan?.name || 'unknown',
  };
}

/**
 * Require active entitlement
 */
export async function requireActiveEntitlement(userId: string): Promise<void> {
  const status = await checkEntitlementStatus(userId);

  if (!status.isActive) {
    throw new SubscriptionInactiveError(status.message || 'inactive', status.plan);
  }
}

/**
 * Check all limits before operation
 */
export async function checkAllLimits(userId: string): Promise<{
  users?: { allowed: boolean; current: number; limit: number };
  storage?: { allowed: boolean; current: number; limit: number };
  apiCalls?: { allowed: boolean; current: number; limit: number };
  plugins?: { allowed: boolean; current: number; limit: number };
}> {
  const entitlement = await getUserEntitlement(userId);

  if (!entitlement) {
    return {};
  }

  const limits = readEffectivePlanLimits(entitlement.plan.limits, entitlement.billingInterval);
  const usage = (entitlement.usageMetrics as Record<string, number>) || {};

  const result: {
    users?: { allowed: boolean; current: number; limit: number };
    storage?: { allowed: boolean; current: number; limit: number };
    apiCalls?: { allowed: boolean; current: number; limit: number };
    plugins?: { allowed: boolean; current: number; limit: number };
  } = {};

  // Storage
  const storageLimit = limits['platform.storageBytes'];
  if (storageLimit !== undefined) {
    const current = usage['platform.storageBytes'] || 0;
    const limit = storageLimit;
    result.storage = {
      allowed: limit === -1 || current < limit,
      current,
      limit,
    };
  }

  // API Calls
  const apiCallsLimit = limits['platform.apiCalls'];
  if (apiCallsLimit !== undefined) {
    const current = usage['platform.apiCalls'] || 0;
    const limit = apiCallsLimit;
    result.apiCalls = {
      allowed: limit === -1 || current < limit,
      current,
      limit,
    };
  }

  // Plugins
  const pluginsLimit = limits['platform.plugins'];
  if (pluginsLimit !== undefined) {
    const current = usage['platform.pluginsInstalled'] || 0;
    const limit = pluginsLimit;
    result.plugins = {
      allowed: limit === -1 || current < limit,
      current,
      limit,
    };
  }

  return result;
}
