'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Bell, Search, Menu, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ProductScopeSwitcher } from '@/components/product-scope/ProductScopeSwitcher';
import { signOut, useSession } from '@/lib/auth/client';
import { useUserRole } from '@/hooks/use-user-role';

/**
 * User dropdown menu items configuration
 * Consistent with MY_ACCOUNT_ITEMS in system-dashboard-menus.ts
 */
const USER_DROPDOWN_ITEMS = [
  { href: '/profile', i18nKey: 'header.profile' },
  { href: '/billing', i18nKey: 'header.billing' },
] as const;

interface AppHeaderProps {
  onMenuClick?: () => void;
}

export function AppHeader({ onMenuClick }: AppHeaderProps) {
  const router = useRouter();
  const t = useTranslations('dashboard');
  const { getLangPath } = useLanguage();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Get current user session and role
  const { data: session, isPending: isSessionLoading } = useSession();
  const { isAdmin } = useUserRole();
  const user = session?.user;

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    router.push(getLangPath('/admin/search'));
  };

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

  // generateUser头像of首字母缩写
  const getUserInitials = (name: string | null | undefined) => {
    if (!name) return 'U';
    const names = name.trim().split(' ');
    if (names.length >= 2) {
      // and名of首字母，例如 "Zhang San" -> "ZS"
      return `${names[0][0]}${names[1][0]}`.toUpperCase();
    }
    //  "Admin" -> "AD"
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-4 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-6">
      {/* Mobile Menu Button */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden hover:bg-primary/10 hover:text-primary transition-all duration-200 hover:scale-105"
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">Toggle menu</span>
      </Button>

      {/* Spacer to push content to the right */}
      <div className="flex-1" />

      {/* Search Bar - Admin only */}
      {isAdmin && (
        <div className="max-w-md w-80">
          <form onSubmit={handleSearch}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder={t('header.searchPlaceholder')}
                className="pl-9 pr-4 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200"
                onClick={() => router.push(getLangPath('/admin/search'))}
              />
            </div>
          </form>
        </div>
      )}

      {/* Right Side Actions */}
      <div className="flex items-center gap-2">
        <ProductScopeSwitcher />

        {/* Language Switcher */}
        <LanguageSwitcher />

        {/* Theme Toggle */}
        <ThemeToggle />

        {/* Notifications */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative hover:bg-primary/10 hover:text-primary transition-all duration-200 hover:scale-105"
            >
              <Bell className="h-5 w-5" />
              <Badge
                variant="destructive"
                className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs"
              >
                3
              </Badge>
              <span className="sr-only">Notifications</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>{t('header.notifications')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="max-h-96 overflow-y-auto">
              <DropdownMenuItem className="flex flex-col items-start gap-1 p-3">
                <p className="text-sm font-medium">{t('header.notificationExample1')}</p>
                <p className="text-xs text-muted-foreground">john.doe@example.com signed up</p>
                <p className="text-xs text-muted-foreground">2 minutes ago</p>
              </DropdownMenuItem>
              <DropdownMenuItem className="flex flex-col items-start gap-1 p-3">
                <p className="text-sm font-medium">{t('header.notificationExample2')}</p>
                <p className="text-xs text-muted-foreground">
                  runtime-seo was installed by jane@example.com
                </p>
                <p className="text-xs text-muted-foreground">1 hour ago</p>
              </DropdownMenuItem>
              <DropdownMenuItem className="flex flex-col items-start gap-1 p-3">
                <p className="text-sm font-medium">{t('header.notificationExample3')}</p>
                <p className="text-xs text-muted-foreground">user_demo exceeded 80% of API quota</p>
                <p className="text-xs text-muted-foreground">3 hours ago</p>
              </DropdownMenuItem>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="justify-center text-center"
              onClick={() => router.push(getLangPath('/notifications'))}
            >
              {t('header.viewAllNotifications')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 px-2" disabled={isSessionLoading}>
              <Avatar className="h-8 w-8">
                <AvatarImage src={user?.image || undefined} alt={user?.name || 'User'} />
                <AvatarFallback>{getUserInitials(user?.name)}</AvatarFallback>
              </Avatar>
              <div className="hidden lg:flex lg:flex-col lg:items-start">
                <span className="text-sm font-medium">
                  {isSessionLoading ? t('header.loading') : user?.name || t('header.unknownUser')}
                </span>
                <span className="text-xs text-muted-foreground">{user?.email || ''}</span>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{t('header.myAccount')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {USER_DROPDOWN_ITEMS.map((item) => (
              <DropdownMenuItem key={item.href} onClick={() => router.push(getLangPath(item.href))}>
                {t(item.i18nKey)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              disabled={isLoggingOut}
              className="cursor-pointer"
            >
              {isLoggingOut && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isLoggingOut ? t('header.loggingOut') : t('header.logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
