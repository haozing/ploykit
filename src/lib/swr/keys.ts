/**
 * API Key Constants
 *
 * Centralized API endpoint definitions for:
 * - Type safety
 * - Easy global search
 * - Cache invalidation
 * - Consistent URL construction
 *
 * Usage:
 * ```tsx
 * import { API_KEYS } from '@/lib/swr/keys';
 *
 * const { data } = useSWR(API_KEYS.USERS.LIST(), fetcher);
 * ```
 */

// ============================================================
// Admin APIs
// ============================================================

export const API_KEYS = {
  // ──────────────────────────────────────────────────────────
  // Users
  // ──────────────────────────────────────────────────────────
  USERS: {
    LIST: (params?: string) => `/api/admin/users${params ? `?${params}` : ''}`,
    STATS: '/api/admin/users/stats',
    DETAIL: (id: string) => `/api/admin/users/${id}`,
    SUSPEND: (id: string) => `/api/admin/users/${id}/suspend`,
    RESTORE: (id: string) => `/api/admin/users/${id}/restore`,
    RESET_PASSWORD: (id: string) => `/api/admin/users/${id}/reset-password`,
  },

  // ──────────────────────────────────────────────────────────
  // Roles
  // ──────────────────────────────────────────────────────────
  ROLES: {
    LIST: (params?: string) => `/api/admin/roles${params ? `?${params}` : ''}`,
    STATS: '/api/admin/roles/stats',
    DETAIL: (id: string) => `/api/admin/roles/${id}`,
    ASSIGN: (id: string) => `/api/admin/roles/${id}/assign`,
    REVOKE: (id: string) => `/api/admin/roles/${id}/revoke`,
  },

  // ──────────────────────────────────────────────────────────
  // Dashboard
  // ──────────────────────────────────────────────────────────
  DASHBOARD: {
    STATS: '/api/admin/dashboard/stats',
    RECENT_USERS: '/api/admin/dashboard/recent-users',
    SYSTEM_STATUS: '/api/admin/dashboard/system-status',
  },

  // ──────────────────────────────────────────────────────────
  // Audit Logs
  // ──────────────────────────────────────────────────────────
  AUDIT_LOGS: {
    LIST: (params?: string) => `/api/admin/audit-logs${params ? `?${params}` : ''}`,
    STATS: (params?: string) => `/api/admin/audit-logs/stats${params ? `?${params}` : ''}`,
    DETAIL: (id: string) => `/api/admin/audit-logs/${id}`,
  },

  // ──────────────────────────────────────────────────────────
  // Analytics
  // ──────────────────────────────────────────────────────────
  ANALYTICS: {
    USAGE_TRENDS: (days: number) => `/api/admin/analytics/usage-trends?days=${days}&metric=all`,
    GROWTH_TRENDS: (days: number) => `/api/admin/analytics/growth-trends?days=${days}`,
    DASHBOARD: (params: string) => `/api/admin/analytics/dashboard?${params}`,
    COHORTS: '/api/admin/analytics/cohorts?months=12',
  },

  // ──────────────────────────────────────────────────────────
  // Entitlements
  // ──────────────────────────────────────────────────────────
  ENTITLEMENTS: {
    STATS: '/api/admin/entitlements/stats',
    PLANS: '/api/admin/entitlements/plans',
    PLAN_DETAIL: (planId: string) => `/api/admin/entitlements/plans/${planId}`,
    USERS: (params?: string) => `/api/admin/entitlements/users${params ? `?${params}` : ''}`,
    USER_DETAIL: (userId: string) => `/api/admin/entitlements/${userId}`,
    USAGE: '/api/admin/entitlements/usage',
  },

  // ──────────────────────────────────────────────────────────
  // Plans (Admin)
  // ──────────────────────────────────────────────────────────
  PLANS: {
    LIST: '/api/admin/entitlements/plans',
    DETAIL: (id: string) => `/api/admin/entitlements/plans/${id}`,
    SYNC_STRIPE: (id: string) => `/api/admin/entitlements/plans/${id}/sync-stripe`,
  },

  // ──────────────────────────────────────────────────────────
  // Billing
  // ──────────────────────────────────────────────────────────
  BILLING: {
    PRODUCTS: (params?: string) => `/api/billing/products${params ? `?${params}` : ''}`,
    PRODUCT_DETAIL: (id: string) => `/api/billing/products/${id}`,
    SKUS: (params?: string) => `/api/billing/skus${params ? `?${params}` : ''}`,
    SKU_SYNC: (id: string) => `/api/billing/skus/${id}/sync-stripe`,
    ORDERS: (params?: string) => `/api/billing/orders${params ? `?${params}` : ''}`,
    SUBSCRIPTIONS: (params?: string) => `/api/billing/subscriptions${params ? `?${params}` : ''}`,
    PORTAL: '/api/billing/portal',
  },

  // ──────────────────────────────────────────────────────────
  // Plugins
  // ──────────────────────────────────────────────────────────
  PLUGINS: {
    LIST: '/api/admin/plugins',
    ENABLE: (id: string) => `/api/admin/plugins/${id}/enable`,
    DISABLE: (id: string) => `/api/admin/plugins/${id}/disable`,
    INSTALL: (id: string) => `/api/admin/plugins/${id}/install`,
    UNINSTALL: (id: string) => `/api/admin/plugins/${id}/uninstall`,
  },

  // ──────────────────────────────────────────────────────────
  // User APIs (Current User)
  // ──────────────────────────────────────────────────────────
  USER: {
    PROFILE: '/api/user/profile',
    ROLE: '/api/user/role',
    SUBSCRIPTION: '/api/user/subscription',
    ORDERS: (limit: number = 50) => `/api/user/orders?limit=${limit}`,
    PREFERENCES: '/api/user/profile/preferences',
    PASSWORD: '/api/user/profile/password',
    AVATAR: '/api/user/profile/avatar',
  },

  // ──────────────────────────────────────────────────────────
  // Entitlements (User-facing)
  // ──────────────────────────────────────────────────────────
  USER_ENTITLEMENTS: {
    GET: (_userId: string) => '/api/user/subscription',
  },

  // ──────────────────────────────────────────────────────────
  // Usage
  // ──────────────────────────────────────────────────────────
  USAGE: {
    GET: (userId: string, params?: string) => `/api/usage/${userId}${params ? `?${params}` : ''}`,
  },

  // ──────────────────────────────────────────────────────────
  // Notifications
  // ──────────────────────────────────────────────────────────
  NOTIFICATIONS: {
    UNREAD: '/api/notifications/unread',
    HISTORY: (limit: number) => `/api/notifications/history?limit=${limit}`,
    PREFERENCES: '/api/notifications/preferences',
    TEST: '/api/notifications/test',
  },

  // ──────────────────────────────────────────────────────────
  // Files
  // ──────────────────────────────────────────────────────────
  FILES: {
    LIST: (search?: string) => `/api/files${search ? `?search=${search}` : ''}`,
    STATS: '/api/files?statsOnly=true',
    UPLOAD: '/api/files',
    DOWNLOAD: (id: string) => `/api/files/${id}?download=true`,
    DELETE: (id: string) => `/api/files/${id}`,
  },

  // ──────────────────────────────────────────────────────────
  // Public APIs
  // ──────────────────────────────────────────────────────────
  PUBLIC: {
    PLANS: '/api/plans',
    CONTACT: '/api/contact',
    CHECKOUT: '/api/checkout/create',
  },
} as const;

// ============================================================
// Helper Types
// ============================================================

/**
 * Extract the return type of an API key function
 */
export type ApiKeyType<T> = T extends (...args: unknown[]) => string ? string : T;
