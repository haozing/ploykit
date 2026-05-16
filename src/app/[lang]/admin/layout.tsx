import { requireAdmin } from '@/lib/shared/role-check';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { getAdminSidebarNavGroups } from '@/lib/ui/navigation';
import { IntlMessagesProvider } from '@/i18n/IntlMessagesProvider';

/**
 * Admin Layout
 *
 * Wraps all admin pages with:
 * - Admin permission check (requireAdmin)
 * - DashboardShell: Shared layout component with sidebar and header
 * - Admin-specific navigation (all admin groups)
 *
 * Security:
 * - Calls requireAdmin() to ensure only admins can access
 * - Redirects non-admin users to /profile
 * - Redirects unauthenticated users to /login
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  //
  // Admin Permission Check (Security Layer)
  //
  // This runs on every admin page request and ensures:
  // 1. User is authenticated (redirects to /login if not)
  // 2. User has admin role (redirects to /profile if not)
  await requireAdmin();

  //
  // Load Admin Navigation (Admin-only groups)
  //
  const navGroups = await getAdminSidebarNavGroups();

  //
  // Render Admin Dashboard (User is authenticated + admin)
  //
  return (
    <IntlMessagesProvider scope="admin">
      <DashboardShell navGroups={navGroups}>{children}</DashboardShell>
    </IntlMessagesProvider>
  );
}
