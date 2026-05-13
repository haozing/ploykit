/**
 * Common Validation Schemas
 *
 * Reusable validation schemas for common data types and patterns
 */

import { z } from 'zod';

/**
 * Common validation schemas for reuse across the application
 */
export const commonSchemas = {
  /**
   * UUID parameter validation
   */
  uuid: z.string().uuid('Invalid UUID format'),

  /**
   * Pagination parameters
   */
  pagination: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().min(1).max(100).default(20),
  }),

  /**
   * Search filter
   */
  search: z.object({
    search: z.string().min(1).max(100).optional(),
  }),

  /**
   * Date range filter
   */
  dateRange: z.object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  }),

  /**
   * Status filter (common statuses across entities)
   */
  status: z.enum(['active', 'suspended', 'deleted', 'cancelled']),

  /**
   * Slug validation (URL-friendly identifiers)
   */
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens'),

  /**
   * Email validation
   */
  email: z.string().email('Invalid email format').toLowerCase().trim(),

  /**
   * URL validation
   */
  url: z.string().url('Invalid URL format'),

  /**
   * ID string (non-empty string identifier)
   */
  id: z.string().min(1, 'ID is required'),
};

/**
 * Create a paginated list query schema
 *
 * Combines pagination and search parameters with optional additional fields
 *
 * @param additionalFields - Additional fields to include in the schema
 * @returns Combined pagination schema with all fields
 *
 * @example
 * ```typescript
 * // Basic pagination
 * const listSchema = createPaginatedListSchema();
 *
 * // With additional filters
 * const listUsersSchema = createPaginatedListSchema({
 *   status: commonSchemas.status.optional(),
 *   role: z.string().optional(),
 * });
 * ```
 */
export function createPaginatedListSchema<T extends z.ZodRawShape>(additionalFields?: T) {
  return z.object({
    ...commonSchemas.pagination.shape,
    ...commonSchemas.search.shape,
    ...additionalFields,
  });
}

/**
 * ID parameter schema (for route params)
 */
export const idParamSchema = z.object({
  id: commonSchemas.uuid,
});

export type IdParam = z.infer<typeof idParamSchema>;

/**
 * Slug parameter schema (for route params)
 */
export const slugParamSchema = z.object({
  slug: commonSchemas.slug,
});

export type SlugParam = z.infer<typeof slugParamSchema>;
