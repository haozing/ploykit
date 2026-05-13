/**
 * ===========================================================================
 * User Menu Client Component (Frontend)
 * ===========================================================================
 *
 * This is a business logic component that cannot be replaced by plugins
 * Plugins can only affect its styles through tokens
 *
 * Use client component to support language routing and authentication state
 *
 * Features:
 * - Not logged in: Show "Login" button
 * - Logged in: Show user avatar and dropdown menu (profile, settings, billing, logout)
 */

'use client';

import Link from 'next/link';
import { useLanguage } from '@/contexts/language-context';
import { useSession } from '@/lib/auth/client';
import { UserDropdown } from '@/components/shared/UserDropdown';
import { Button } from '@/components/ui/button';

export function UserMenuClient() {
  const { getLangPath } = useLanguage();
  const { data: session, isPending } = useSession();

  // Loading state: show placeholder
  if (isPending) {
    return <div className="w-10 h-10 rounded-full bg-muted animate-pulse" />;
  }

  // User dropdown menu
  if (session?.user) {
    return <UserDropdown variant="compact" />;
  }

  // Login button
  return (
    <Link href={getLangPath('/login')}>
      <Button className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg hover:scale-105 transition-all duration-200">
        Login
      </Button>
    </Link>
  );
}
