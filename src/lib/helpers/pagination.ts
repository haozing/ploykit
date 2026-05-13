/**
 * Pagination Helper
 *
 * Provides reusable pagination utilities to reduce code duplication
 */

import { PgSelect } from 'drizzle-orm/pg-core';

/**
 * Pagination options
 */
export interface PaginationOptions {
  page?: number;
  limit?: number;
}

/**
 * Paginated result structure
 */
export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

/**
 * Default pagination values
 */
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Validate and normalize pagination options
 */
export function normalizePaginationOptions(
  options: PaginationOptions = {}
): Required<PaginationOptions> {
  const page = Math.max(1, options.page || DEFAULT_PAGE);
  const limit = Math.min(MAX_LIMIT, Math.max(1, options.limit || DEFAULT_LIMIT));

  return { page, limit };
}

/**
 * Calculate pagination offset
 */
export function calculateOffset(page: number, limit: number): number {
  return (page - 1) * limit;
}

/**
 * Build pagination metadata
 */
export function buildPaginationMetadata(
  page: number,
  limit: number,
  total: number
): PaginatedResult<never>['pagination'] {
  const totalPages = Math.ceil(total / limit);

  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

/**
 * Generic paginate function for Drizzle queries
 *
 * @example
 * ```typescript
 * const result = await paginate(
 *   db.select().from(users).where(eq(users.status, 'active')),
 *   { page: 1, limit: 20 }
 * );
 * ```
 */
export async function paginate<T extends PgSelect>(
  query: T,
  options: PaginationOptions = {}
): Promise<PaginatedResult<Awaited<T>[number]>> {
  const { page, limit } = normalizePaginationOptions(options);
  const offset = calculateOffset(page, limit);

  // Clone query for count
  const countQuery = query.$dynamic();

  // Execute both queries in parallel
  const [items, countResult] = await Promise.all([
    query.limit(limit).offset(offset),
    // Count query - need to get the underlying SQL
    (async () => {
      try {
        // Try to get count using SQL
        // This is a workaround since Drizzle doesn't have a built-in count method
        const result = await countQuery.execute();
        return result.length;
      } catch {
        return 0;
      }
    })(),
  ]);

  const total = countResult;
  const pagination = buildPaginationMetadata(page, limit, total);

  return {
    items: items,
    pagination,
  };
}

/**
 * Paginate with custom count query
 *
 * Use this when you need more control over the count query
 *
 * @example
 * ```typescript
 * const result = await paginateWithCount(
 *   db.select().from(users).where(eq(users.status, 'active')),
 *   db.select({ count: sql`count(*)` }).from(users).where(eq(users.status, 'active')),
 *   { page: 1, limit: 20 }
 * );
 * ```
 */
export async function paginateWithCount<T>(
  itemsQuery: Promise<T[]>,
  countQuery: Promise<{ count: number }[]>,
  options: PaginationOptions = {}
): Promise<PaginatedResult<T>> {
  const { page, limit } = normalizePaginationOptions(options);

  // Execute both queries in parallel
  const [items, countResult] = await Promise.all([itemsQuery, countQuery]);

  const total = Number(countResult[0]?.count || 0);
  const pagination = buildPaginationMetadata(page, limit, total);

  return {
    items,
    pagination,
  };
}

/**
 * Simple pagination for arrays (for in-memory pagination)
 *
 * @example
 * ```typescript
 * const allItems = await db.select().from(users);
 * const result = paginateArray(allItems, { page: 2, limit: 10 });
 * ```
 */
export function paginateArray<T>(items: T[], options: PaginationOptions = {}): PaginatedResult<T> {
  const { page, limit } = normalizePaginationOptions(options);
  const offset = calculateOffset(page, limit);

  const paginatedItems = items.slice(offset, offset + limit);
  const pagination = buildPaginationMetadata(page, limit, items.length);

  return {
    items: paginatedItems,
    pagination,
  };
}

/**
 * Cursor-based pagination helper
 *
 * @example
 * ```typescript
 * const result = await paginateCursor(
 *   db.select().from(users).where(eq(users.status, 'active')),
 *   { cursor: lastUserId, limit: 20 }
 * );
 * ```
 */
export interface CursorPaginationOptions {
  cursor?: string;
  limit?: number;
}

export interface CursorPaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function paginateCursor<T extends { id: string }>(
  items: T[],
  options: CursorPaginationOptions = {}
): Promise<CursorPaginatedResult<T>> {
  const limit = Math.min(MAX_LIMIT, options.limit || DEFAULT_LIMIT);

  // Take one extra to check if there are more items
  const itemsWithExtra = items.slice(0, limit + 1);
  const hasMore = itemsWithExtra.length > limit;
  const paginatedItems = hasMore ? itemsWithExtra.slice(0, limit) : itemsWithExtra;

  const nextCursor = hasMore ? paginatedItems[paginatedItems.length - 1]?.id || null : null;

  return {
    items: paginatedItems,
    nextCursor,
    hasMore,
  };
}
