'use client';

/**
 * SWR Provider
 *
 * Wraps the application with SWR configuration.
 * Provides global settings for all useSWR hooks.
 *
 * Features:
 * - Centralized configuration
 * - Default fetcher with 401 handling
 * - Error handling and retry logic
 * - Request deduplication
 */

import { SWRConfig } from 'swr';
import { swrConfig } from '@/lib/swr/config';
import { fetcher } from '@/lib/swr/fetcher';

interface SWRProviderProps {
  children: React.ReactNode;
}

export function SWRProvider({ children }: SWRProviderProps) {
  return (
    <SWRConfig
      value={{
        ...swrConfig,
        fetcher,
      }}
    >
      {children}
    </SWRConfig>
  );
}
