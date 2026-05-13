/**
 * SWR Module Exports
 *
 * Re-exports all SWR utilities for convenient imports.
 *
 * @example
 * ```tsx
 * import { fetcher, API_KEYS, swrConfig } from '@/lib/swr';
 * ```
 */

export { swrConfig } from './config';
export {
  fetcher,
  postFetcher,
  patchFetcher,
  putFetcher,
  deleteFetcher,
  createTypedFetcher,
  FetchError,
} from './fetcher';
export { API_KEYS } from './keys';
