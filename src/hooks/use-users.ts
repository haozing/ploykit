'use client';

import { useState, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { API_KEYS, fetcher, postFetcher, putFetcher, deleteFetcher } from '@/lib/swr';
import type { Pagination } from './types/common';

/**
 * User interface matching the API response
 */
export interface User {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  emailVerified?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * User with additional computed properties
 */
export interface UserWithDetails extends User {
  role?: { id: string; name: string; slug: string } | null;
  subscription?: {
    planName: string;
    planSlug: string;
    endDate: string | null;
  } | null;
  status?: 'active' | 'pending' | 'suspended' | 'deleted';
  lastLogin?: string;
}

/**
 * User filters for API queries
 */
export interface UserFilters {
  search?: string;
  status?: 'active' | 'pending' | 'suspended' | 'deleted' | 'all';
  page?: number;
  limit?: number;
}

/**
 * User statistics
 */
export interface UserStats {
  total: number;
  active: number;
  pending: number;
  suspended: number;
  deleted: number;
}

// ============================================================
// Response Types
// ============================================================

interface UsersResponse {
  success: boolean;
  users: UserWithDetails[];
  pagination: Pagination;
}

interface StatsResponse {
  success: boolean;
  stats: UserStats;
}

interface UserResponse {
  success: boolean;
  user: UserWithDetails;
  temporaryPassword?: string;
  message?: string;
}

const normalizeOptionalDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
};

const normalizeRequiredDate = (value: Date | string): Date => {
  return value instanceof Date ? value : new Date(value);
};

const normalizeUser = (user: UserWithDetails): UserWithDetails => ({
  ...user,
  emailVerified: normalizeOptionalDate(user.emailVerified),
  createdAt: normalizeRequiredDate(user.createdAt),
  updatedAt: normalizeRequiredDate(user.updatedAt),
});

// ============================================================
// Hooks
// ============================================================

/**
 * Custom hook for managing users
 *
 * Uses SWR for:
 * - Automatic request deduplication
 * - Smart caching
 * - Automatic revalidation
 *
 * @param initialFilters - Initial filter values
 * @returns Users data, loading state, and helper functions
 *
 * @example
 * ```tsx
 * const { users, loading, stats, pagination, setFilters, refetch } = useUsers({
 *   page: 1,
 *   limit: 50
 * });
 * ```
 */
export function useUsers(initialFilters: UserFilters = {}) {
  const [filters, setFiltersState] = useState<UserFilters>({
    page: 1,
    limit: 50,
    ...initialFilters,
  });

  // Build query string from filters
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.status && filters.status !== 'all') {
      params.set('status', filters.status);
    }
    params.set('page', String(filters.page || 1));
    params.set('limit', String(filters.limit || 50));
    return params.toString();
  }, [filters]);

  // Fetch users list
  const {
    data: usersData,
    error: usersError,
    isLoading: usersLoading,
    mutate: mutateUsers,
  } = useSWR<UsersResponse>(API_KEYS.USERS.LIST(queryString), fetcher);

  // Fetch stats (separate SWR call for independent caching)
  const {
    data: statsData,
    error: statsError,
    isLoading: statsLoading,
    mutate: mutateStats,
  } = useSWR<StatsResponse>(API_KEYS.USERS.STATS, fetcher);

  // Update filters
  const setFilters = useCallback((newFilters: Partial<UserFilters>) => {
    setFiltersState((prev) => ({
      ...prev,
      ...newFilters,
      // Reset page to 1 when filters change (except when page is explicitly set)
      page: newFilters.page !== undefined ? newFilters.page : 1,
    }));
  }, []);

  // Refetch all data
  const refetch = useCallback(() => {
    void mutateUsers();
    void mutateStats();
  }, [mutateUsers, mutateStats]);

  return {
    users: usersData?.users.map(normalizeUser) || [],
    stats: statsData?.stats || null,
    loading: usersLoading,
    statsLoading,
    error: usersError || statsError,
    pagination: usersData?.pagination || null,
    filters,
    setFilters,
    refetch,
    // Expose mutate functions for cache invalidation
    mutateUsers,
    mutateStats,
  };
}

/**
 * Custom hook for a single user
 *
 * @param userId - User ID
 * @returns User data and loading state
 */
export function useUser(userId: string | null) {
  const {
    data,
    error,
    isLoading: loading,
    mutate,
  } = useSWR<UserResponse>(userId ? API_KEYS.USERS.DETAIL(userId) : null, fetcher);

  return {
    user: data?.user ? normalizeUser(data.user) : null,
    loading,
    error: error?.message || null,
    refetch: mutate,
  };
}

// ============================================================
// Mutations
// ============================================================

/**
 * Hook for deleting a user
 *
 * @example
 * ```tsx
 * const { trigger, isMutating } = useDeleteUser();
 * await trigger('user-123');
 * ```
 */
export function useDeleteUser() {
  return useSWRMutation(
    API_KEYS.USERS.STATS, // Use stats key for cache invalidation
    async (_key: string, { arg: userId }: { arg: string }) => {
      return deleteFetcher<{ success: boolean; error?: string }>(API_KEYS.USERS.DETAIL(userId));
    }
  );
}

/**
 * Hook for updating a user
 *
 * @example
 * ```tsx
 * const { trigger, isMutating } = useUpdateUser();
 * await trigger({ userId: 'user-123', updates: { name: 'New Name' } });
 * ```
 */
export function useUpdateUser() {
  return useSWRMutation(
    API_KEYS.USERS.STATS, // Use stats key for cache invalidation
    async (_key: string, { arg }: { arg: { userId: string; updates: Partial<User> } }) => {
      return putFetcher<UserResponse, Partial<User>>(API_KEYS.USERS.DETAIL(arg.userId), {
        arg: arg.updates,
      });
    }
  );
}

export function useSuspendUser() {
  return useSWRMutation(
    API_KEYS.USERS.STATS,
    async (_key: string, { arg }: { arg: { userId: string; reason?: string } }) => {
      return postFetcher<UserResponse, { reason?: string }>(API_KEYS.USERS.SUSPEND(arg.userId), {
        arg: { reason: arg.reason },
      });
    }
  );
}

export function useRestoreUser() {
  return useSWRMutation(
    API_KEYS.USERS.STATS,
    async (_key: string, { arg: userId }: { arg: string }) => {
      return postFetcher<UserResponse, Record<string, never>>(API_KEYS.USERS.RESTORE(userId), {
        arg: {},
      });
    }
  );
}

export function useResetUserPassword() {
  return useSWRMutation(
    API_KEYS.USERS.STATS,
    async (_key: string, { arg: userId }: { arg: string }) => {
      return postFetcher<UserResponse, Record<string, never>>(
        API_KEYS.USERS.RESET_PASSWORD(userId),
        {
          arg: {},
        }
      );
    }
  );
}
