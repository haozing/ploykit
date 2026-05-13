'use client';

/**
 * User Role Hook
 *
 * Client-side hook to get current user's role.
 * Uses SWR for automatic 401 handling and caching.
 *
 * Usage:
 * ```tsx
 * const { role, isAdmin, isLoading } = useUserRole();
 *
 * if (isLoading) return <Spinner />;
 * if (isAdmin) return <AdminPanel />;
 * ```
 */

import useSWR from 'swr';
import { useSession } from '@/lib/auth/client';
import { API_KEYS, fetcher } from '@/lib/swr';

export type UserRole = 'admin' | 'user' | null;

interface RoleResponse {
  role: UserRole;
}

interface UseUserRoleReturn {
  /** Current user's role */
  role: UserRole;
  /** True if user is admin */
  isAdmin: boolean;
  /** True if user is regular user */
  isUser: boolean;
  /** True while fetching role */
  isLoading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Refetch role data */
  refetch: () => void;
}

/**
 * Get current user's role from API
 *
 * @returns Role information and loading state
 */
export function useUserRole(): UseUserRoleReturn {
  const { data: session, isPending: sessionLoading } = useSession();

  // Only fetch role if we have a session
  const shouldFetch = !sessionLoading && session?.user;

  const { data, error, isLoading, mutate } = useSWR<RoleResponse>(
    shouldFetch ? API_KEYS.USER.ROLE : null,
    fetcher,
    {
      // Don't revalidate on focus for role (it rarely changes)
      revalidateOnFocus: false,
      // Cache role for longer
      dedupingInterval: 60000, // 1 minute
    }
  );

  const role = data?.role ?? null;

  return {
    role,
    isAdmin: role === 'admin',
    isUser: role === 'user',
    isLoading: sessionLoading || isLoading,
    error: error?.message ?? null,
    refetch: () => void mutate(),
  };
}
