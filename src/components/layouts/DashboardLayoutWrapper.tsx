/**
 * Dashboard Layout Wrapper
 *
 * Used to provide dashboard layout in pages outside the (dashboard) route group
 * Reuses DashboardShell component for consistent layout
 *
 * Features:
 * - Session verification and redirect
 * - Load dynamic navigation (user context with admin entry if applicable)
 * - Provide unified sidebar + header layout via DashboardShell
 */

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/server';
import { isAdmin } from '@/lib/auth/permissions';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { defaultLocale } from '@/i18n/config';
import { getUserSidebarNavGroups } from '@/lib/ui/navigation';
import { getUserAccountAccessStatus } from '@/lib/services/user/user-status';

interface DashboardLayoutWrapperProps {
  children: React.ReactNode;
}

/**
 * DashboardLayoutWrapper Component
 *
 * Provides complete dashboard layout for pages outside route groups
 * Uses user navigation context (shows admin entry if user is admin)
 */
export async function DashboardLayoutWrapper({ children }: DashboardLayoutWrapperProps) {
  //
  // Session Validation (Security Layer)
  //
  const headersList = await headers();

  const session = await auth.api.getSession({
    headers: headersList,
  });

  // Redirect to login if no valid session
  if (!session?.user) {
    const pathname = headersList.get('x-pathname') || '/billing';
    const callbackUrl = encodeURIComponent(pathname);
    redirect(`/${defaultLocale}/login?callbackUrl=${callbackUrl}`);
  }

  const accountStatus = await getUserAccountAccessStatus(session.user.id);
  if (accountStatus !== 'active') {
    redirect(`/${defaultLocale}/login?error=account_${accountStatus}`);
  }

  //
  // Load Dynamic Navigation
  //

  // Check if user is admin (for showing admin console entry)
  const userIsAdmin = await isAdmin(session.user.id);

  // Load user navigation (myAccount group, with admin entry if applicable)
  const navGroups = await getUserSidebarNavGroups(userIsAdmin);

  //
  // Render Dashboard Layout
  //
  return <DashboardShell navGroups={navGroups}>{children}</DashboardShell>;
}
