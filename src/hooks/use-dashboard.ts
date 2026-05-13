'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { API_KEYS, fetcher } from '@/lib/swr';
import type { ApiResponse } from './types/common';

/**
 * Dashboard stats interface
 */
export interface DashboardStats {
  users: {
    total: number;
    growth: string;
    growthValue: number;
  };
  subscriptions: {
    total: number;
    active: number;
    description: string;
  };
  roles: {
    total: number;
    active: number;
    description: string;
  };
  plugins: {
    total: number;
    enabled: number;
    description: string;
  };
  apiRequests: {
    total: string;
    growth: string;
    trend: 'up' | 'down' | 'flat';
  };
  meta?: {
    rangeDays: number;
    usageSource: string;
  };
}

/**
 * Recent user interface
 */
export interface RecentUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  status: 'active' | 'pending';
  time: string;
  createdAt: Date;
}

/**
 * System service status interface
 */
export interface SystemService {
  name: string;
  status: 'operational' | 'degraded' | 'down';
  latency: string;
  statusCode: 'ok' | 'warning' | 'error';
  details?: Record<string, unknown>;
}

// ============================================================
// Response Types
// ============================================================

type StatsResponse = ApiResponse<DashboardStats>;
type RecentUsersResponse = ApiResponse<RecentUser[]>;
type SystemStatusResponse = ApiResponse<SystemService[]>;

// ============================================================
// Hook
// ============================================================

/**
 * useDashboard Hook
 *
 * Uses SWR for automatic request deduplication and caching.
 *
 * @returns Object containing dashboard data, loading states, and control functions
 *
 * @example
 * ```tsx
 * const { stats, recentUsers, systemStatus, loading, refetch } = useDashboard();
 * ```
 */
export function useDashboard() {
  // Fetch stats
  const {
    data: statsData,
    error: statsError,
    isLoading: statsLoading,
    mutate: mutateStats,
  } = useSWR<StatsResponse>(API_KEYS.DASHBOARD.STATS, fetcher);

  // Fetch recent users
  const {
    data: usersData,
    error: usersError,
    isLoading: usersLoading,
    mutate: mutateUsers,
  } = useSWR<RecentUsersResponse>(API_KEYS.DASHBOARD.RECENT_USERS, fetcher);

  // Fetch system status
  const {
    data: statusData,
    error: statusError,
    isLoading: statusLoading,
    mutate: mutateStatus,
  } = useSWR<SystemStatusResponse>(API_KEYS.DASHBOARD.SYSTEM_STATUS, fetcher);

  // Refetch all data
  const refetch = useCallback(() => {
    void mutateStats();
    void mutateUsers();
    void mutateStatus();
  }, [mutateStats, mutateUsers, mutateStatus]);

  return {
    stats: statsData?.data || null,
    recentUsers: usersData?.data || [],
    systemStatus: statusData?.data || [],
    loading: statsLoading || usersLoading || statusLoading,
    statsLoading,
    usersLoading,
    statusLoading,
    error: statsError || usersError || statusError,
    refetch,
  };
}
