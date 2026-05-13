/**
 * ════════════════════════════════════════════════════════════
 * User Dropdown Menu Component - Shared Frontend/Backend
 * ════════════════════════════════════════════════════════════
 *
 * Reusable user menu component, supports frontend and backend use
 *
 * Features:
 * - Supports compact (avatar only) and full (avatar + name + email) modes
 * - Automatically gets user login status
 * - Menu: Profile, Billing, Logout
 * - Supports multi-language routing
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/language-context';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { signOut, useSession } from '@/lib/auth/client';

interface UserDropdownProps {
  /**
   * Display mode
   * - compact: Show avatar only (suitable for frontend)
   * - full: Show avatar + name + email (suitable for backend)
   */
  variant?: 'full' | 'compact';
}

export function UserDropdown({ variant = 'compact' }: UserDropdownProps) {
  const t = useTranslations('components.shared.userDropdown');
  const router = useRouter();
  const { getLangPath } = useLanguage();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Get current user session
  const { data: session, isPending: isSessionLoading } = useSession();
  const user = session?.user;

  // Handle logout
  const handleSignOut = async () => {
    try {
      setIsLoggingOut(true);
      await signOut({
        fetchOptions: {
          onSuccess: () => {
            router.push(getLangPath('/login'));
            router.refresh();
          },
        },
      });
    } catch (error) {
      console.error('Logout error:', error);
      // Even if error occurs, try to redirect to login page
      router.push(getLangPath('/login'));
      router.refresh();
    } finally {
      setIsLoggingOut(false);
    }
  };

  // Generate user avatar initials
  const getUserInitials = (name: string | null | undefined) => {
    if (!name) return 'U';
    const names = name.trim().split(' ');
    if (names.length >= 2) {
      // First letter of first and last name, e.g., "Zhang San" -> "ZS"
      return `${names[0][0]}${names[1][0]}`.toUpperCase();
    }
    // Single name, e.g., "Admin" -> "AD"
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="gap-2 px-2 hover:bg-primary/10 hover:text-primary transition-all duration-200 hover:scale-105"
          disabled={isSessionLoading}
        >
          <Avatar className="h-8 w-8">
            <AvatarImage src={user?.image || undefined} alt={user?.name || 'User'} />
            <AvatarFallback className="bg-primary/10 text-primary font-medium">
              {getUserInitials(user?.name)}
            </AvatarFallback>
          </Avatar>
          {variant === 'full' && (
            <div className="hidden lg:flex lg:flex-col lg:items-start">
              <span className="text-sm font-medium">
                {isSessionLoading ? t('loading') : user?.name || t('unknownUser')}
              </span>
              <span className="text-xs text-muted-foreground">{user?.email || ''}</span>
            </div>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t('myAccount')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push(getLangPath('/profile'))}>
          {t('menu.profile')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push(getLangPath('/billing'))}>
          {t('menu.billing')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleSignOut}
          disabled={isLoggingOut}
          className="cursor-pointer"
        >
          {isLoggingOut && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isLoggingOut ? t('loggingOut') : t('menu.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
