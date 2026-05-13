/**
 * ErrorFallback - Error Fallback UI Component
 *
 * Features:
 * - Display friendly error messages
 * - Show different messages based on error context
 * - Provide retry and back to home actions
 * - Show detailed error info in development environment
 *
 * Use cases:
 * - Default fallback for ErrorBoundary
 * - Custom error pages
 */

'use client';

interface Props {
  error?: Error;
  context?: string;
  onReset?: () => void;
}

export function ErrorFallback({ error, context, onReset }: Props) {
  // Check if it's a plugin error
  const isPlugin = context?.startsWith('plugin:');
  const pluginName = isPlugin ? context?.split(':')[1] : undefined;

  return (
    <div className="min-h-screen bg-muted flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-card rounded-lg shadow-lg p-6">
        {/* Error icon and title */}
        <div className="flex items-start mb-4">
          <div className="flex-shrink-0">
            <svg
              className="h-8 w-8 text-destructive"
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
          <div className="ml-3 flex-1">
            <h3 className="text-lg font-medium text-foreground">
              {isPlugin ? 'Plugin Loading Failed' : 'An Error Occurred'}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {isPlugin
                ? `Plugin "${pluginName}" encountered an error`
                : 'The application encountered an unexpected error'}
            </p>
          </div>
        </div>

        {/* Error details (development only) */}
        {error && process.env.NODE_ENV === 'development' && (
          <div className="mt-3 p-3 bg-destructive-50 rounded border border-destructive">
            <p className="text-xs font-semibold text-destructive-foreground mb-1">{error.name}</p>
            <p className="text-xs text-destructive font-mono break-all">{error.message}</p>
            {error.stack && (
              <details className="mt-2">
                <summary className="text-xs text-destructive cursor-pointer hover:underline">
                  View stack trace
                </summary>
                <pre className="mt-1 text-[10px] text-destructive overflow-x-auto">
                  {error.stack}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-5 flex gap-2">
          {onReset && (
            <button
              onClick={onReset}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded hover:bg-primary/90 transition-colors"
            >
              Retry
            </button>
          )}
          <button
            onClick={() => (window.location.href = '/')}
            className="flex-1 px-4 py-2 bg-muted text-muted-foreground text-sm font-medium rounded hover:bg-muted/80 transition-colors"
          >
            Back to Home
          </button>
        </div>

        {/* Help message */}
        {process.env.NODE_ENV === 'production' && (
          <p className="mt-4 text-xs text-muted-foreground text-center">
            If the problem persists, please contact technical support
          </p>
        )}
      </div>
    </div>
  );
}
