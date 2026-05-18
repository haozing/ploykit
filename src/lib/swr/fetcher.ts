/**
 * SWR Fetcher Utilities
 *
 * Provides unified data fetching functions for SWR hooks.
 * Built on top of apiFetch to ensure:
 * - Automatic 401 handling and redirect
 * - Consistent error handling
 * - Type-safe responses
 */

import { apiFetch } from '@/lib/shared/auth-client';

/**
 * Custom error class for fetch failures
 *
 * Includes HTTP status and response data for detailed error handling
 */
export class FetchError extends Error {
  status: number;
  info?: unknown;

  constructor(message: string, status: number, info?: unknown) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
    this.info = info;
  }
}

function errorMessageFromInfo(info: unknown, fallback: string): string {
  if (info && typeof info === 'object') {
    const error = (info as { error?: unknown }).error;
    if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.length > 0) {
        return message;
      }
    }
    if (typeof error === 'string' && error.length > 0) {
      return error;
    }
  }
  return fallback;
}

/**
 * Standard fetcher for GET requests
 *
 * Used as the default fetcher for useSWR hooks.
 * Automatically handles:
 * - 401 redirects (via apiFetch)
 * - Error responses
 * - JSON parsing
 *
 * @example
 * ```tsx
 * const { data } = useSWR('/api/users', fetcher);
 * ```
 */
export async function fetcher<T>(url: string): Promise<T> {
  const response = await apiFetch(url);

  if (!response.ok) {
    const info = await response.json().catch(() => null);
    throw new FetchError(
      errorMessageFromInfo(info, `Request failed: ${response.statusText}`),
      response.status,
      info
    );
  }

  return response.json();
}

/**
 * POST fetcher for mutations
 *
 * Used with useSWRMutation for POST requests.
 *
 * @example
 * ```tsx
 * const { trigger } = useSWRMutation('/api/users', postFetcher);
 * await trigger({ name: 'John' });
 * ```
 */
export async function postFetcher<T, A = unknown>(url: string, { arg }: { arg: A }): Promise<T> {
  const response = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(arg),
  });

  if (!response.ok) {
    const info = await response.json().catch(() => null);
    throw new FetchError(
      errorMessageFromInfo(info, `Request failed: ${response.statusText}`),
      response.status,
      info
    );
  }

  return response.json();
}

/**
 * PATCH fetcher for updates
 *
 * Used with useSWRMutation for PATCH requests.
 *
 * @example
 * ```tsx
 * const { trigger } = useSWRMutation('/api/users/123', patchFetcher);
 * await trigger({ name: 'Updated Name' });
 * ```
 */
export async function patchFetcher<T, A = unknown>(url: string, { arg }: { arg: A }): Promise<T> {
  const response = await apiFetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(arg),
  });

  if (!response.ok) {
    const info = await response.json().catch(() => null);
    throw new FetchError(
      errorMessageFromInfo(info, `Request failed: ${response.statusText}`),
      response.status,
      info
    );
  }

  return response.json();
}

/**
 * PUT fetcher for full updates
 *
 * Used with useSWRMutation for PUT requests.
 */
export async function putFetcher<T, A = unknown>(url: string, { arg }: { arg: A }): Promise<T> {
  const response = await apiFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(arg),
  });

  if (!response.ok) {
    const info = await response.json().catch(() => null);
    throw new FetchError(
      errorMessageFromInfo(info, `Request failed: ${response.statusText}`),
      response.status,
      info
    );
  }

  return response.json();
}

/**
 * DELETE fetcher for deletions
 *
 * Used with useSWRMutation for DELETE requests.
 *
 * @example
 * ```tsx
 * const { trigger } = useSWRMutation('/api/users/123', deleteFetcher);
 * await trigger();
 * ```
 */
export async function deleteFetcher<T>(url: string): Promise<T> {
  const response = await apiFetch(url, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const info = await response.json().catch(() => null);
    throw new FetchError(
      errorMessageFromInfo(info, `Request failed: ${response.statusText}`),
      response.status,
      info
    );
  }

  return response.json();
}

/**
 * Create a typed fetcher with specific response type
 *
 * Useful when you need a fetcher with a specific type for reuse.
 *
 * @example
 * ```tsx
 * const usersFetcher = createTypedFetcher<UsersResponse>();
 * const { data } = useSWR('/api/users', usersFetcher);
 * ```
 */
export function createTypedFetcher<T>() {
  return (url: string) => fetcher<T>(url);
}
