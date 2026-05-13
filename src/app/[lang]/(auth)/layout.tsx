/**
 * Authentication Page Layout
 *
 * Features:
 * - Center-aligned authentication form
 * - Maximum width constraint
 * - Vertical centering
 * - Responsive design
 */

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4 py-8">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
