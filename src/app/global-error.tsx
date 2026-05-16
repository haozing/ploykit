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
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: '#f8fafc',
          color: '#111827',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <main
          style={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: 16,
          }}
        >
          <section
            style={{
              background: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)',
              maxWidth: 420,
              padding: 28,
              textAlign: 'center',
              width: '100%',
            }}
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="64"
              stroke="#dc2626"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="64"
            >
              <path
                d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>

            <h1
              style={{
                fontSize: 28,
                lineHeight: 1.2,
                margin: '20px 0 8px',
              }}
            >
              Application Crashed
            </h1>

            <p
              style={{
                color: '#4b5563',
                fontSize: 15,
                lineHeight: 1.6,
                margin: '0 0 24px',
              }}
            >
              The application encountered an unrecoverable error.
            </p>

            <div
              style={{
                display: 'flex',
                gap: 10,
              }}
            >
              <button
                onClick={reset}
                style={{
                  background: '#4f46e5',
                  border: 0,
                  borderRadius: 6,
                  color: '#ffffff',
                  cursor: 'pointer',
                  flex: 1,
                  fontSize: 14,
                  fontWeight: 600,
                  padding: '10px 14px',
                }}
              >
                Reload
              </button>
              <button
                onClick={() => {
                  window.location.href = '/';
                }}
                style={{
                  background: '#e5e7eb',
                  border: 0,
                  borderRadius: 6,
                  color: '#111827',
                  cursor: 'pointer',
                  flex: 1,
                  fontSize: 14,
                  fontWeight: 600,
                  padding: '10px 14px',
                }}
              >
                Return to Home
              </button>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
