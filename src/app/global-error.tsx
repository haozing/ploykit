/**
 * global-error.tsx - Next.js global error handling.
 *
 * Catches errors in the root layout. This component must render its own
 * <html> and <body> tags.
 *
 * Documentation: https://nextjs.org/docs/app/building-your-application/routing/error-handling#handling-errors-in-root-layouts
 */

'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="min-h-screen bg-muted flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-card rounded-lg shadow-lg p-6 text-center">
            <div className="mb-4">
              <svg
                className="h-16 w-16 text-destructive mx-auto"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>

            <h1 className="text-2xl font-bold text-foreground mb-2">Application Crashed</h1>

            <p className="text-muted-foreground mb-6">
              The application encountered an unrecoverable error.
            </p>

            {process.env.NODE_ENV === 'development' && error && (
              <div className="mb-6 p-3 bg-destructive-50 rounded border border-destructive text-left">
                <p className="text-xs font-semibold text-destructive-foreground mb-1">
                  {error.name}
                </p>
                <p className="text-xs text-destructive font-mono break-all">{error.message}</p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => reset()}
                className="flex-1 px-4 py-2 bg-primary text-white text-sm font-medium rounded hover:bg-primary transition-colors"
              >
                Reload
              </button>
              <button
                onClick={() => (window.location.href = '/')}
                className="flex-1 px-4 py-2 bg-accent text-foreground text-sm font-medium rounded hover:bg-gray-300 transition-colors"
              >
                Return to Home
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
