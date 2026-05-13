'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Bell, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { apiFetch } from '@/lib/shared/auth-client';
import { useLanguage } from '@/contexts/language-context';

interface NotificationHistoryRecord {
  id: string;
  type: string;
  channel: 'email' | 'webhook' | 'in_app';
  recipient: string;
  subject: string | null;
  body: string;
  status: 'pending' | 'sent' | 'failed';
  sentAt: string | null;
  createdAt: string;
}

interface NotificationBellProps {
  userId: string;
}

export function NotificationBell({ userId: _userId }: NotificationBellProps) {
  const t = useTranslations('components.notifications.notificationBell');
  const { getLangPath } = useLanguage();

  const [notifications, setNotifications] = React.useState<NotificationHistoryRecord[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [isOpen, setIsOpen] = React.useState(false);

  React.useEffect(() => {
    if (isOpen) {
      void fetchNotifications();
    }
  }, [isOpen]);

  // Auto-refresh every 60 seconds
  React.useEffect(() => {
    const interval = setInterval(() => {
      if (isOpen) {
        void fetchNotifications();
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [isOpen]);

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const response = await apiFetch('/api/notifications/unread');
      const data = await response.json();

      if (data.success) {
        setNotifications(data.notifications);
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const getNotificationIcon = (type: string) => {
    if (type.includes('exceeded') || type.includes('failed')) {
      return <AlertCircle className="h-4 w-4 text-destructive" />;
    }
    if (type.includes('critical')) {
      return <AlertTriangle className="h-4 w-4 text-warning" />;
    }
    if (type.includes('warning')) {
      return <AlertTriangle className="h-4 w-4 text-warning" />;
    }
    if (type.includes('success') || type.includes('upgraded')) {
      return <CheckCircle2 className="h-4 w-4 text-success" />;
    }
    return <Info className="h-4 w-4 text-primary" />;
  };

  const formatNotificationType = (type: string): string => {
    return type
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const unreadCount = notifications.length;

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[400px]">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>{t('notifications')}</span>
          {unreadCount > 0 && (
            <Badge variant="secondary" className="ml-2">
              {t('new', { count: unreadCount })}
            </Badge>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">{t('loading')}</div>
        ) : notifications.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t('noNotifications')}
          </div>
        ) : (
          <div className="max-h-[400px] overflow-y-auto">
            {notifications.map((notification) => (
              <DropdownMenuItem
                key={notification.id}
                className="flex items-start gap-3 p-3 cursor-pointer"
              >
                <div className="mt-0.5">{getNotificationIcon(notification.type)}</div>
                <div className="flex-1 space-y-1">
                  <div className="font-medium text-sm">
                    {notification.subject || formatNotificationType(notification.type)}
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-2">
                    {notification.body}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {notification.sentAt
                      ? formatDistanceToNow(new Date(notification.sentAt), { addSuffix: true })
                      : formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                  </div>
                </div>
              </DropdownMenuItem>
            ))}
          </div>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem className="justify-center text-sm" asChild>
          <Link href={getLangPath('/notifications')} className="w-full text-center cursor-pointer">
            {t('viewAll')}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
