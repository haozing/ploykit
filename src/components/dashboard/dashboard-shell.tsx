import { AppSidebar } from '@/components/dashboard/app-sidebar';
import { AppHeader } from '@/components/dashboard/app-header';
import type { NavGroupConfig } from '@/lib/ui/navigation/types';

interface DashboardShellProps {
  navGroups: NavGroupConfig[];
  children: React.ReactNode;
}

/**
 * Dashboard Shell Component
 *
 * Shared layout wrapper for both user dashboard and admin dashboard.
 * Provides consistent structure:
 * - Sidebar navigation (desktop only)
 * - Header with search and user menu
 * - Main content area with gradient background
 *
 * Used by:
 * - (dashboard)/layout.tsx - User dashboard (profile, billing, settings)
 * - admin/layout.tsx - Admin dashboard (users, plans, analytics, etc.)
 */
export function DashboardShell({ navGroups, children }: DashboardShellProps) {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar - Pass dynamic navigation data */}
      <aside className="hidden lg:block w-64 flex-shrink-0 shadow-[var(--shadow-sidebar)]">
        <AppSidebar navGroups={navGroups} />
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <AppHeader />

        {/* Page Content */}
        <main
          tabIndex={0}
          className="flex-1 overflow-y-auto bg-gradient-to-br from-background via-background to-muted/5 p-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:p-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
