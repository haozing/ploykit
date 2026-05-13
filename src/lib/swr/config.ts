/**
 * SWR Global Configuration
 *
 * Centralized configuration for all SWR hooks.
 * Provides sensible defaults for:
 * - Revalidation behavior
 * - Error retry logic
 * - Deduplication settings
 */

import type { SWRConfiguration } from 'swr';

export const swrConfig: SWRConfiguration = {
  // Revalidate on window focus (disabled to reduce unnecessary requests)
  revalidateOnFocus: false,

  // Revalidate on network reconnection
  revalidateOnReconnect: true,

  // Number of retry attempts on error
  errorRetryCount: 3,

  // Interval between retries (ms)
  errorRetryInterval: 5000,

  // Dedupe requests within this interval (ms)
  // Prevents duplicate requests when multiple components use the same key
  dedupingInterval: 2000,

  // Throttle focus events (ms)
  focusThrottleInterval: 5000,

  // Keep previous data while revalidating
  keepPreviousData: true,

  // Revalidate on mount if data is stale
  revalidateIfStale: true,

  // Disable automatic revalidation on mount (we'll control this per-hook)
  revalidateOnMount: true,
};
