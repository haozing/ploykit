/**
 * error.tsx - Next.js app route error handling.
 *
 * Catches errors from Server Components and Client Components.
 * Documentation: https://nextjs.org/docs/app/building-your-application/routing/error-handling
 */

'use client';

import { useEffect } from 'react';
import { ErrorFallback } from '@/components/errors';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App error:', error);

    // Sentry.captureException(error);
  }, [error]);

  return <ErrorFallback error={error} context="app" onReset={reset} />;
}
