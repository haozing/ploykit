'use client';

import { useState, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import { API_KEYS, fetcher } from '@/lib/swr';
import type { ApiResponse, Pagination } from './types/common';

/**
 * Entitlement statistics interface
 */
export interface EntitlementStats {
  plans: {
    total: number;
    active: number;
    inactive: number;
  };
  subscriptions: {
    total: number;
    active: number;
    trial: number;
    cancelled: number;
  };
  revenue: {
    monthly: number;
    formatted: string;
  };
}

/**
 * Plan features interface
 */
export interface PlanFeatures {
  [key: string]: boolean | string | number | undefined;
}

/**
 * Plan limits interface
 */
export interface PlanLimitsByInterval {
  monthly?: Record<string, number>;
  yearly?: Record<string, number>;
}

export interface PlanPricing {
  currency?: string;
  monthly?: number;
  yearly?: number;
  [key: string]: unknown;
}

export interface PlanStripeConfig {
  productId?: string | null;
  priceIdMonthly?: string | null;
  priceIdYearly?: string | null;
  [key: string]: unknown;
}

/**
 * Plan with subscriber count interface
 */
export interface PlanWithSubscribers {
  id: string;
  name: string;
  slug: string;
  features: PlanFeatures;
  limits: PlanLimitsByInterval;
  pricing?: PlanPricing;
  stripe?: PlanStripeConfig;
  langJsonb?: Record<string, unknown> | null;
  sortOrder: number;
  isActive: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  subscriberCount: number;
}

/**
 * User entitlement interface (with user details)
 */
export interface UserEntitlementWithDetails {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  billingInterval?: string | null;
  plan: {
    id: string;
    name: string;
    slug: string;
    pricing?: PlanPricing;
    langJsonb?: Record<string, unknown> | null;
    limits: PlanLimitsByInterval;
  };
  status: string;
  startDate: string;
  startDateRaw: Date;
  endDate: string;
  endDateRaw: Date | null;
  daysInfo: string;
  usageMetrics: Record<string, number>;
  usageUpdatedAt: Date | null;
  notes: string | null;
  createdAgo: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// Response Types
// ============================================================

type StatsResponse = ApiResponse<EntitlementStats>;
type PlansResponse = ApiResponse<PlanWithSubscribers[]>;
type UserEntitlementsResponse = ApiResponse<{
  entitlements: UserEntitlementWithDetails[];
  pagination: Pagination;
}>;

// ============================================================
// Hook
// ============================================================

/**
 * useEntitlements Hook
 *
 * Uses SWR for automatic request deduplication and caching.
 *
 * @returns Object containing entitlement data, loading states, and control functions
 *
 * @example
 * ```tsx
 * const { stats, plans, userEntitlements, statsLoading, plansLoading, entitlementsLoading, refetch } = useEntitlements();
 * ```
 */
export function useEntitlements() {
  const [entitlementFilters, setEntitlementFilters] = useState<{
    search?: string;
    planId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }>({});

  // Build query string for user entitlements
  const entitlementsQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (entitlementFilters.search) params.append('search', entitlementFilters.search);
    if (entitlementFilters.planId) params.append('planId', entitlementFilters.planId);
    if (entitlementFilters.status) params.append('status', entitlementFilters.status);
    if (entitlementFilters.page) params.append('page', entitlementFilters.page.toString());
    if (entitlementFilters.limit) params.append('limit', entitlementFilters.limit.toString());
    return params.toString();
  }, [entitlementFilters]);

  // Fetch stats
  const {
    data: statsData,
    error: statsError,
    isLoading: statsLoading,
    mutate: mutateStats,
  } = useSWR<StatsResponse>(API_KEYS.ENTITLEMENTS.STATS, fetcher);

  // Fetch plans
  const {
    data: plansData,
    error: plansError,
    isLoading: plansLoading,
    mutate: mutatePlans,
  } = useSWR<PlansResponse>(API_KEYS.ENTITLEMENTS.PLANS, fetcher);

  // Fetch user entitlements
  const {
    data: entitlementsData,
    error: entitlementsError,
    isLoading: entitlementsLoading,
    mutate: mutateEntitlements,
  } = useSWR<UserEntitlementsResponse>(
    API_KEYS.ENTITLEMENTS.USERS(entitlementsQueryString || undefined),
    fetcher
  );

  // Fetch user entitlements with filters
  const fetchUserEntitlements = useCallback(
    (filters?: {
      search?: string;
      planId?: string;
      status?: string;
      page?: number;
      limit?: number;
    }) => {
      setEntitlementFilters(filters || {});
    },
    []
  );

  // Refetch all data
  const refetch = useCallback(() => {
    void mutateStats();
    void mutatePlans();
    void mutateEntitlements();
  }, [mutateStats, mutatePlans, mutateEntitlements]);

  return {
    stats: statsData?.data || null,
    plans: plansData?.data || [],
    userEntitlements: entitlementsData?.data?.entitlements || [],
    pagination: entitlementsData?.data?.pagination || null,
    loading: statsLoading || plansLoading || entitlementsLoading,
    statsLoading,
    plansLoading,
    entitlementsLoading,
    error: statsError || plansError || entitlementsError,
    refetch,
    fetchStats: mutateStats,
    fetchPlans: mutatePlans,
    fetchUserEntitlements,
  };
}
