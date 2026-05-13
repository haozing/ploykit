'use client';

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { API_KEYS, fetcher } from '@/lib/swr';

/**
 * Entitlement Hook
 *
 * React hook for checking user entitlements and feature access.
 * Uses SWR for automatic 401 handling and caching.
 *
 * Usage:
 * ```tsx
 * const { hasFeature, plan, limits, loading } = useEntitlement(userId);
 *
 * if (hasFeature('platform.apiAccess')) {
 *   // Show custom domain settings
 * }
 * ```
 */

export interface PlanLimits {
  users: number;
  storage: number; // MB
  apiCalls: number;
  plugins: number;
}

export interface PlanFeatures {
  'platform.prioritySupport': boolean;
  'platform.apiAccess': boolean;
  'platform.webhooksAccess': boolean;
  'platform.premiumTools': boolean;
  'platform.advancedFeatures': boolean;
  'platform.pluginInstall': boolean;
}

export interface EntitlementData {
  planId: string;
  planName: string;
  status: 'active' | 'trial' | 'expired' | 'cancelled';
  limits: PlanLimits;
  features: PlanFeatures;
  startDate: Date;
  endDate: Date | null;
  trialEndsAt: Date | null;
}

interface EntitlementResponse {
  plan: {
    id: string;
    name: string;
    limits: Partial<PlanLimits> & {
      monthly?: Record<string, number>;
      yearly?: Record<string, number>;
    };
    features: Partial<PlanFeatures> & Record<string, unknown>;
  };
  status: 'active' | 'trial' | 'expired' | 'cancelled';
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  startDate?: string;
  endDate?: string | null;
  trialEndsAt?: string | null;
}

interface UseEntitlementResult {
  entitlement: EntitlementData | null;
  plan: string | null;
  planId: string | null;
  status: 'active' | 'trial' | 'expired' | 'cancelled' | null;
  limits: PlanLimits | null;
  features: PlanFeatures | null;
  hasFeature: (featureName: keyof PlanFeatures) => boolean;
  hasAnyFeature: (featureNames: (keyof PlanFeatures)[]) => boolean;
  hasAllFeatures: (featureNames: (keyof PlanFeatures)[]) => boolean;
  isActive: boolean;
  isTrial: boolean;
  isExpired: boolean;
  daysUntilExpiry: number | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useEntitlement(userId: string | null): UseEntitlementResult {
  const { data, error, isLoading, mutate } = useSWR<EntitlementResponse>(
    userId ? API_KEYS.USER_ENTITLEMENTS.GET(userId) : null,
    fetcher,
    {
      // Cache entitlements for longer
      dedupingInterval: 60000, // 1 minute
    }
  );

  // Transform API response to EntitlementData
  const entitlement = useMemo<EntitlementData | null>(() => {
    if (!data) return null;
    const startDate = data.startDate ?? data.currentPeriodStart ?? new Date().toISOString();
    const endDate = data.endDate ?? data.currentPeriodEnd ?? null;
    return {
      planId: data.plan.id,
      planName: data.plan.name,
      status: data.status,
      limits: normalizePlanLimits(data.plan.limits),
      features: normalizePlanFeatures(data.plan.features),
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : null,
      trialEndsAt: data.trialEndsAt ? new Date(data.trialEndsAt) : null,
    };
  }, [data]);

  /**
   * Check if user has access to a specific feature
   */
  const hasFeature = useCallback(
    (featureName: keyof PlanFeatures): boolean => {
      if (!entitlement || !entitlement.features) return false;
      return entitlement.features[featureName] === true;
    },
    [entitlement]
  );

  /**
   * Check if user has ANY of the specified features
   */
  const hasAnyFeature = useCallback(
    (featureNames: (keyof PlanFeatures)[]): boolean => {
      return featureNames.some((feature) => hasFeature(feature));
    },
    [hasFeature]
  );

  /**
   * Check if user has ALL of the specified features
   */
  const hasAllFeatures = useCallback(
    (featureNames: (keyof PlanFeatures)[]): boolean => {
      return featureNames.every((feature) => hasFeature(feature));
    },
    [hasFeature]
  );

  /**
   * Calculate days until subscription expires
   */
  const daysUntilExpiry = useMemo((): number | null => {
    if (!entitlement) return null;

    const expiryDate = entitlement.trialEndsAt || entitlement.endDate;
    if (!expiryDate) return null; // No expiry (lifetime/unlimited)

    const now = new Date();
    const diffTime = expiryDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays > 0 ? diffDays : 0;
  }, [entitlement]);

  const isActive = entitlement?.status === 'active';
  const isTrial = entitlement?.status === 'trial';
  const isExpired = entitlement?.status === 'expired';

  return {
    entitlement,
    plan: entitlement?.planName || null,
    planId: entitlement?.planId || null,
    status: entitlement?.status || null,
    limits: entitlement?.limits || null,
    features: entitlement?.features || null,
    hasFeature,
    hasAnyFeature,
    hasAllFeatures,
    isActive,
    isTrial,
    isExpired,
    daysUntilExpiry,
    loading: isLoading,
    error: error || null,
    refetch: () => void mutate(),
  };
}

function normalizePlanLimits(limits: EntitlementResponse['plan']['limits']): PlanLimits {
  const monthlyLimits = limits.monthly ?? {};
  const readLimit = (key: string) => {
    const value = monthlyLimits[key];
    if (typeof value === 'number') {
      return value;
    }
    return 0;
  };

  return {
    users: readLimit('platform.users'),
    storage: readLimit('platform.storageBytes'),
    apiCalls: readLimit('platform.apiCalls'),
    plugins: readLimit('platform.plugins'),
  };
}

function normalizePlanFeatures(features: EntitlementResponse['plan']['features']): PlanFeatures {
  return {
    'platform.prioritySupport': features['platform.prioritySupport'] === true,
    'platform.apiAccess': features['platform.apiAccess'] === true,
    'platform.webhooksAccess': features['platform.webhooksAccess'] === true,
    'platform.premiumTools': features['platform.premiumTools'] === true,
    'platform.advancedFeatures': features['platform.advancedFeatures'] === true,
    'platform.pluginInstall': features['platform.pluginInstall'] === true,
  };
}

/**
 * Entitlement Gate Component
 *
 * Conditionally render children based on feature access
 *
 * Usage:
 * ```tsx
 * <EntitlementGate
 *   feature="platform.apiAccess"
 *   userId={userId}
 *   fallback={<UpgradePrompt />}
 * >
 *   <CustomDomainSettings />
 * </EntitlementGate>
 * ```
 */
interface EntitlementGateProps {
  feature: keyof PlanFeatures | (keyof PlanFeatures)[];
  requireAll?: boolean;
  fallback?: React.ReactNode;
  children: React.ReactNode;
  userId: string | null;
  showUpgradePrompt?: boolean;
}

export function EntitlementGate({
  feature,
  requireAll = false,
  fallback = null,
  children,
  userId,
  showUpgradePrompt = false,
}: EntitlementGateProps) {
  const { hasFeature, hasAnyFeature, hasAllFeatures, plan, loading } = useEntitlement(userId);

  if (loading) {
    return null; // or a loading spinner
  }

  const features = Array.isArray(feature) ? feature : [feature];

  const hasAccess = requireAll
    ? hasAllFeatures(features)
    : Array.isArray(feature)
      ? hasAnyFeature(features)
      : hasFeature(feature);

  if (hasAccess) {
    return <>{children}</>;
  }

  // Show upgrade prompt if enabled
  if (showUpgradePrompt) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-amber-100 p-2">
            <svg
              className="h-5 w-5 text-amber-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-amber-900">Upgrade Required</h3>
            <p className="mt-1 text-sm text-amber-700">
              This feature is not available in your current plan ({plan || 'Free'}). Upgrade to
              unlock advanced features.
            </p>
            <Link
              href="/billing/upgrade"
              className="mt-3 inline-flex items-center rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-500"
            >
              View Plans
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{fallback}</>;
}

/**
 * Hook for checking if user can perform an action based on status
 */
export function useEntitlementStatus(userId: string | null) {
  const { isActive, isTrial, isExpired, daysUntilExpiry, status, loading, error } =
    useEntitlement(userId);

  const canPerformActions = isActive || isTrial;
  const needsRenewal = isExpired;
  const isExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry <= 7;

  return {
    canPerformActions,
    needsRenewal,
    isExpiringSoon,
    daysUntilExpiry,
    status,
    loading,
    error,
  };
}
