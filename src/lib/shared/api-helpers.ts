/**
 * API Helper Functions
 *
 * Common utility functions for API routes
 * Reduces code duplication and ensures consistency
 */

import { NextRequest } from 'next/server';
import { PAGINATION } from '@/lib/_core/constants';

/**
 * Extract client IP address from request
 *
 * Handles various proxy headers and formats
 *
 * @param request - Next.js request object
 * @returns Client IP address or undefined
 *
 * @example
 * ```typescript
 * export const POST = async (request: NextRequest) => {
 *   const ipAddress = getClientIP(request);
 *   await auditLog({ ipAddress, ... });
 * };
 * ```
 */
export function getClientIP(request: NextRequest): string | undefined {
  // Try x-forwarded-for first (most common proxy header)
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    // x-forwarded-for can be comma-separated list: "client, proxy1, proxy2"
    // We want the first (original client) IP
    return forwardedFor.split(',')[0]?.trim();
  }

  // Try x-real-ip (used by some proxies)
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  // Try cf-connecting-ip (Cloudflare)
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) {
    return cfIp.trim();
  }

  // Try true-client-ip (Akamai, Cloudflare Enterprise)
  const trueClientIp = request.headers.get('true-client-ip');
  if (trueClientIp) {
    return trueClientIp.trim();
  }

  // No IP found
  return undefined;
}

/**
 * Extract user agent from request
 *
 * @param request - Next.js request object
 * @returns User agent string or undefined
 */
export function getUserAgent(request: NextRequest): string | undefined {
  return request.headers.get('user-agent') || undefined;
}

/**
 * Extract referer from request
 *
 * @param request - Next.js request object
 * @returns Referer URL or undefined
 */
export function getReferer(request: NextRequest): string | undefined {
  return request.headers.get('referer') || undefined;
}

/**
 * Check if request is from a mobile device
 *
 * @param request - Next.js request object
 * @returns true if mobile device
 */
export function isMobileRequest(request: NextRequest): boolean {
  const userAgent = getUserAgent(request);
  if (!userAgent) return false;

  const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
  return mobileRegex.test(userAgent);
}

/**
 * Parse request body safely
 *
 * Handles JSON parsing errors gracefully
 *
 * @param request - Next.js request object
 * @returns Parsed body or null if invalid
 *
 * @example
 * ```typescript
 * const body = await parseRequestBody(request);
 * if (!body) {
 *   return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
 * }
 * ```
 */
export async function parseRequestBody<T = unknown>(request: NextRequest): Promise<T | null> {
  try {
    const body = await request.json();
    return body as T;
  } catch {
    return null;
  }
}

/**
 * Get request metadata for logging
 *
 * Collects common request metadata for audit logs
 *
 * @param request - Next.js request object
 * @returns Request metadata object
 *
 * @example
 * ```typescript
 * export const POST = async (request: NextRequest) => {
 *   const metadata = getRequestMetadata(request);
 *   await auditLog({
 *     ...metadata,
 *     action: 'CREATE_ORG',
 *   });
 * };
 * ```
 */
export function getRequestMetadata(request: NextRequest) {
  return {
    ipAddress: getClientIP(request),
    userAgent: getUserAgent(request),
    referer: getReferer(request),
    method: request.method,
    url: request.url,
    isMobile: isMobileRequest(request),
  };
}

/**
 * Normalize pagination parameters
 *
 * Ensures page and limit are within valid ranges
 *
 * @param page - Page number (1-indexed)
 * @param limit - Items per page
 * @returns Normalized pagination object
 *
 * @example
 * ```typescript
 * const { page, limit, offset } = normalizePagination(
 *   parseInt(searchParams.get('page') || '1'),
 *   parseInt(searchParams.get('limit') || '20')
 * );
 * ```
 */
export function normalizePagination(page?: number, limit?: number) {
  const normalizedPage = Math.max(page || PAGINATION.DEFAULT_PAGE, PAGINATION.DEFAULT_PAGE);

  const normalizedLimit = Math.max(
    PAGINATION.MIN_LIMIT,
    Math.min(limit || PAGINATION.DEFAULT_LIMIT, PAGINATION.MAX_LIMIT)
  );

  const offset = (normalizedPage - 1) * normalizedLimit;

  return {
    page: normalizedPage,
    limit: normalizedLimit,
    offset,
  };
}

/**
 * Calculate pagination metadata
 *
 * @param total - Total number of items
 * @param page - Current page
 * @param limit - Items per page
 * @returns Pagination metadata
 *
 * @example
 * ```typescript
 * const pagination = getPaginationMetadata(150, 2, 20);
 * // {
 * //   page: 2,
 * //   limit: 20,
 * //   total: 150,
 * //   totalPages: 8,
 * //   hasNext: true,
 * //   hasPrev: true
 * // }
 * ```
 */
export function getPaginationMetadata(total: number, page: number, limit: number) {
  const totalPages = Math.ceil(total / limit);

  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/**
 * Build filter conditions from query parameters
 *
 * Helper for building WHERE clauses from query params
 *
 * @param params - Query parameters object
 * @param allowedFilters - List of allowed filter keys
 * @returns Filtered object with only allowed keys
 *
 * @example
 * ```typescript
 * const filters = buildFilters(
 *   { status: 'active', role: 'admin', foo: 'bar' },
 *   ['status', 'role']
 * );
 * // Result: { status: 'active', role: 'admin' }
 * ```
 */
export function buildFilters<T extends Record<string, unknown>>(
  params: Record<string, unknown>,
  allowedFilters: (keyof T)[]
): Partial<T> {
  const filters: Partial<T> = {};

  for (const key of allowedFilters) {
    const value = params[key as string];
    if (value !== undefined && value !== null && value !== '') {
      filters[key] = value as T[keyof T];
    }
  }

  return filters;
}

/**
 * Wait with timeout
 *
 * Creates a promise that rejects after specified timeout
 *
 * @param ms - Timeout in milliseconds
 * @param message - Error message
 * @returns Promise that rejects after timeout
 *
 * @example
 * ```typescript
 * const result = await Promise.race([
 *   fetchData(),
 *   timeoutPromise(5000, 'Fetch timeout')
 * ]);
 * ```
 */
export function timeoutPromise(ms: number, message = 'Operation timeout'): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

/**
 * Retry with exponential backoff
 *
 * @param fn - Function to retry
 * @param options - Retry options
 * @returns Result of function
 *
 * @example
 * ```typescript
 * const data = await retryWithBackoff(
 *   () => fetchFromAPI(),
 *   { maxRetries: 3, initialDelay: 1000 }
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffMultiplier?: number;
  } = {}
): Promise<T> {
  const { maxRetries = 3, initialDelay = 1000, maxDelay = 10000, backoffMultiplier = 2 } = options;

  let lastError: Error | undefined;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if it's the last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, delay));

      // Increase delay for next attempt (exponential backoff)
      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }

  throw lastError || new Error('Retry failed');
}

/**
 * Batch items into chunks
 *
 * @param items - Array of items
 * @param chunkSize - Size of each chunk
 * @returns Array of chunks
 *
 * @example
 * ```typescript
 * const items = [1, 2, 3, 4, 5, 6, 7];
 * const chunks = batchItems(items, 3);
 * // Result: [[1, 2, 3], [4, 5, 6], [7]]
 * ```
 */
export function batchItems<T>(items: T[], chunkSize: number): T[][] {
  const batches: T[][] = [];

  for (let i = 0; i < items.length; i += chunkSize) {
    batches.push(items.slice(i, i + chunkSize));
  }

  return batches;
}

/**
 * Safe JSON stringify
 *
 * Handles circular references and bigints
 *
 * @param value - Value to stringify
 * @param space - Indentation spaces
 * @returns JSON string
 */
export function safeStringify(value: unknown, space?: number): string {
  const seen = new WeakSet();

  return JSON.stringify(
    value,
    (key, val) => {
      // Handle bigint
      if (typeof val === 'bigint') {
        return val.toString();
      }

      // Handle circular references
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) {
          return '[Circular]';
        }
        seen.add(val);
      }

      return val;
    },
    space
  );
}

/**
 * Delay execution
 *
 * @param ms - Milliseconds to delay
 * @returns Promise that resolves after delay
 *
 * @example
 * ```typescript
 * await delay(1000); // Wait 1 second
 * ```
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
