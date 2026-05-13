'use client';

import { useState, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import { API_KEYS, fetcher } from '@/lib/swr';
import type { ApiResponse } from './types/common';

/**
 * Trend data interface
 */
export interface TrendData {
  label: string;
  data: number[];
  growth?: number;
  total?: number;
  average?: number;
}

/**
 * Usage trends response interface
 */
export interface UsageTrends {
  dateLabels: string[];
  period: string;
  days: number;
  users?: TrendData;
  plugins?: TrendData;
  roles?: TrendData;
  subscriptions?: TrendData;
}

/**
 * Growth trends response interface
 */
export interface GrowthTrends {
  dateLabels: string[];
  period: string;
  days: number;
  newUsers: TrendData;
  newPlugins: TrendData;
  newRoles: TrendData;
  newSubscriptions: TrendData;
}

// ============================================================
// Response Types
// ============================================================

type UsageTrendsResponse = ApiResponse<UsageTrends>;
type GrowthTrendsResponse = ApiResponse<GrowthTrends>;

// ============================================================
// Hook
// ============================================================

/**
 * useAnalytics Hook
 *
 * Uses SWR for automatic request deduplication and caching.
 *
 * @param initialDays - Number of days to look back (default: 30)
 * @returns Object containing analytics data, loading states, and control functions
 *
 * @example
 * ```tsx
 * const { usageTrends, growthTrends, loading, refetch, setDays } = useAnalytics(30);
 * ```
 */
export function useAnalytics(initialDays: number = 30) {
  const [days, setDaysState] = useState(initialDays);

  // Build API keys based on days
  const usageTrendsKey = useMemo(() => API_KEYS.ANALYTICS.USAGE_TRENDS(days), [days]);
  const growthTrendsKey = useMemo(() => API_KEYS.ANALYTICS.GROWTH_TRENDS(days), [days]);

  // Fetch usage trends
  const {
    data: usageTrendsData,
    error: usageTrendsError,
    isLoading: usageTrendsLoading,
    mutate: mutateUsageTrends,
  } = useSWR<UsageTrendsResponse>(usageTrendsKey, fetcher);

  // Fetch growth trends
  const {
    data: growthTrendsData,
    error: growthTrendsError,
    isLoading: growthTrendsLoading,
    mutate: mutateGrowthTrends,
  } = useSWR<GrowthTrendsResponse>(growthTrendsKey, fetcher);

  // Update days and trigger refetch (SWR will handle this automatically via key change)
  const setDays = useCallback((newDays: number) => {
    setDaysState(newDays);
  }, []);

  // Refetch all data
  const refetch = useCallback(() => {
    void mutateUsageTrends();
    void mutateGrowthTrends();
  }, [mutateUsageTrends, mutateGrowthTrends]);

  return {
    usageTrends: usageTrendsData?.data || null,
    growthTrends: growthTrendsData?.data || null,
    loading: usageTrendsLoading || growthTrendsLoading,
    usageTrendsLoading,
    growthTrendsLoading,
    error: usageTrendsError || growthTrendsError,
    days,
    setDays,
    refetch,
  };
}
