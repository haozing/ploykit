import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/server';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { defaultLocale } from '@/i18n/config';
import { getUserSidebarNavGroups } from '@/lib/ui/navigation';
import { isAdmin } from '@/lib/auth/permissions';
import { getUserAccountAccessStatus } from '@/lib/services/user/user-status';

/**
 * User Dashboard Layout
 *
 * Wraps all user dashboard pages (profile, billing, settings) with:
 * - DashboardShell: Shared layout component with sidebar and header
 * - User-specific navigation (myAccount group only)
 *
 * Protected Layout: Requires valid session
 *
 * Note: Admin pages have been moved to a separate /admin route
 * with its own layout that includes admin-specific navigation.
 *
 * Security Layers:
 * - Layer 1 (Middleware): Fast check if session cookie exists
 * - Layer 2 (This Layout): Full session validation - THIS IS THE REAL SECURITY
 * - Layer 3 (API Routes): Per-endpoint auth via withAuth middleware
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  //
  // Session Validation (Security Layer 2 - THE REAL PROTECTION)
  //

  // Get headers once and reuse for both session check and pathname
  const headersList = await headers();

  const session = await auth.api.getSession({
    headers: headersList,
  });

  // Redirect to login if no valid session
  if (!session?.user) {
    const pathname = headersList.get('x-pathname') || '/profile';
    const callbackUrl = encodeURIComponent(pathname);
    redirect(`/${defaultLocale}/login?callbackUrl=${callbackUrl}`);
  }

  const accountStatus = await getUserAccountAccessStatus(session.user.id);
  if (accountStatus !== 'active') {
    redirect(`/${defaultLocale}/login?error=account_${accountStatus}`);
  }

  //
  // Load User Navigation
  //

  // Check if user is admin (for showing admin console entry)
  const userIsAdmin = await isAdmin(session.user.id);

  // Load user navigation (myAccount group only, with admin entry if applicable)
  const navGroups = await getUserSidebarNavGroups(userIsAdmin);

  //
  // Render Dashboard (User is authenticated)
  //

  return <DashboardShell navGroups={navGroups}>{children}</DashboardShell>;
}
