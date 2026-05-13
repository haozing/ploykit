'use client';

import { useState, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { API_KEYS, fetcher, postFetcher, putFetcher, deleteFetcher } from '@/lib/swr';
import type { ApiResponse, Pagination } from './types/common';

/**
 * Role interface representing a role in the system
 */
export interface Role {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  permissions?: string[];
  isDefault?: boolean;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Extended role interface with additional details
 */
export interface RoleWithDetails extends Role {
  permissions?: string[];
  userCount?: number;
}

/**
 * Role statistics interface
 */
export interface RoleStats {
  total: number;
  assigned: number;
}

/**
 * Filters for roles query
 */
export interface RoleFilters {
  search?: string;
  isDefault?: boolean;
  page?: number;
  limit?: number;
}

// ============================================================
// Response Types
// ============================================================

interface RolesResponse {
  success: boolean;
  roles: RoleWithDetails[];
  pagination: Pagination;
}

interface StatsResponse {
  success: boolean;
  data: RoleStats;
}

interface RoleResponse {
  success: boolean;
  data?: RoleWithDetails;
  role?: RoleWithDetails;
  error?: string;
}

// ============================================================
// Hooks
// ============================================================

/**
 * useRoles Hook
 *
 * Uses SWR for automatic request deduplication and caching.
 *
 * @param initialFilters - Initial filter values
 * @returns Object containing roles, stats, loading states, and control functions
 *
 * @example
 * ```tsx
 * const { roles, stats, loading, setFilters, refetch } = useRoles({
 *   page: 1,
 *   limit: 50,
 *   type: 'all'
 * });
 * ```
 */
export function useRoles(initialFilters: RoleFilters = {}) {
  const [filters, setFiltersState] = useState<RoleFilters>({
    page: 1,
    limit: 50,
    ...initialFilters,
  });

  // Build query string from filters
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.page) params.append('page', filters.page.toString());
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.search) params.append('search', filters.search);
    if (filters.isDefault !== undefined) params.append('isDefault', filters.isDefault.toString());
    return params.toString();
  }, [filters]);

  // Fetch roles list
  const {
    data: rolesData,
    error: rolesError,
    isLoading: rolesLoading,
    mutate: mutateRoles,
  } = useSWR<RolesResponse>(API_KEYS.ROLES.LIST(queryString), fetcher);

  // Fetch stats
  const {
    data: statsData,
    error: statsError,
    isLoading: statsLoading,
    mutate: mutateStats,
  } = useSWR<StatsResponse>(API_KEYS.ROLES.STATS, fetcher);

  // Update filters
  const setFilters = useCallback((newFilters: Partial<RoleFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...newFilters }));
  }, []);

  // Refetch all data
  const refetch = useCallback(() => {
    void mutateRoles();
    void mutateStats();
  }, [mutateRoles, mutateStats]);

  return {
    roles: rolesData?.roles || [],
    stats: statsData?.data || null,
    loading: rolesLoading,
    statsLoading,
    error: rolesError || statsError,
    pagination: rolesData?.pagination || null,
    filters,
    setFilters,
    refetch,
    mutateRoles,
    mutateStats,
  };
}

/**
 * useRole Hook
 *
 * Custom hook for fetching a single role by ID
 *
 * @param roleId - The role ID to fetch
 * @returns Object containing role data and loading state
 */
export function useRole(roleId: string | null) {
  const {
    data,
    error,
    isLoading: loading,
    mutate,
  } = useSWR<RoleResponse>(roleId ? API_KEYS.ROLES.DETAIL(roleId) : null, fetcher);

  return {
    role: data?.data || null,
    loading,
    error: error?.message || null,
    refetch: mutate,
  };
}

// ============================================================
// Mutations
// ============================================================

/**
 * Hook for deleting a role
 */
export function useDeleteRole() {
  return useSWRMutation(
    API_KEYS.ROLES.STATS,
    async (_key: string, { arg: roleId }: { arg: string }) => {
      return deleteFetcher<ApiResponse<void>>(API_KEYS.ROLES.DETAIL(roleId));
    }
  );
}

/**
 * Hook for updating a role
 */
export function useUpdateRole() {
  return useSWRMutation(
    API_KEYS.ROLES.STATS,
    async (_key: string, { arg }: { arg: { roleId: string; updates: Partial<Role> } }) => {
      return putFetcher<RoleResponse, Partial<Role>>(API_KEYS.ROLES.DETAIL(arg.roleId), {
        arg: arg.updates,
      });
    }
  );
}

/**
 * Hook for creating a role
 */
export function useCreateRole() {
  return useSWRMutation(
    API_KEYS.ROLES.STATS,
    async (_key: string, { arg }: { arg: Omit<Role, 'id' | 'createdAt' | 'updatedAt'> }) => {
      return postFetcher<RoleResponse, Omit<Role, 'id' | 'createdAt' | 'updatedAt'>>(
        '/api/admin/roles',
        { arg }
      );
    }
  );
}

/**
 * Hook for assigning a role to a user
 */
export function useAssignRole() {
  return useSWRMutation(
    API_KEYS.ROLES.STATS,
    async (_key: string, { arg }: { arg: { roleId: string; userId: string } }) => {
      return postFetcher<ApiResponse<void>, { userId: string }>(API_KEYS.ROLES.ASSIGN(arg.roleId), {
        arg: { userId: arg.userId },
      });
    }
  );
}

/**
 * Hook for revoking a role from a user
 */
export function useRevokeRole() {
  return useSWRMutation(
    API_KEYS.ROLES.STATS,
    async (_key: string, { arg }: { arg: { roleId: string; userId: string } }) => {
      return postFetcher<ApiResponse<void>, { userId: string }>(API_KEYS.ROLES.REVOKE(arg.roleId), {
        arg: { userId: arg.userId },
      });
    }
  );
}
