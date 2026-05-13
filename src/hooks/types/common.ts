/**
 * Common Types for Hooks
 *
 * Shared type definitions used across multiple hooks.
 * Extracted to avoid duplication and ensure consistency.
 */

/**
 * Standard API response format
 *
 * Used by all API endpoints to maintain consistent response structure
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  pagination?: Pagination;
}

/**
 * Pagination metadata
 *
 * Used for paginated API responses to track current page, total items, etc.
 */
export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
