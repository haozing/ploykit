'use client';

import * as React from 'react';
import { formatDistanceToNow, isToday } from 'date-fns';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  Info,
  Mail,
  Trash2,
  RefreshCw,
  Webhook,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiFetch } from '@/lib/shared/auth-client';
import { useTranslations } from 'next-intl';

type NotificationTab = 'all' | 'unread' | 'read';

interface NotificationRecord {
  id: string;
  type: string;
  channel: 'email' | 'webhook' | 'in_app';
  recipient: string;
  subject: string | null;
  body: string;
  status: 'pending' | 'sent' | 'failed';
  error: string | null;
  readAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface NotificationHistoryResponse {
  success?: boolean;
  history?: NotificationRecord[];
  pagination?: {
    total?: number;
  };
  error?: string;
  message?: string;
}

/**
 * Notifications List Page
 *
 * Displays notification history from the authenticated user's real notification API.
 */
export default function NotificationsPage() {
  const t = useTranslations('dashboard.notifications');
  const [activeTab, setActiveTab] = React.useState<NotificationTab>('all');
  const [notifications, setNotifications] = React.useState<NotificationRecord[]>([]);
  const [totalCount, setTotalCount] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [actionMessage, setActionMessage] = React.useState<string | null>(null);
  const [actingId, setActingId] = React.useState<string | null>(null);
  const [markingAllRead, setMarkingAllRead] = React.useState(false);

  const fetchNotifications = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiFetch('/api/notifications/history?limit=50', {
        cache: 'no-store',
      });
      const data = (await response.json()) as NotificationHistoryResponse;

      if (!response.ok || data.success !== true || !Array.isArray(data.history)) {
        throw new Error(data.error || data.message || 'Failed to load notifications');
      }

      setNotifications(data.history);
      setTotalCount(typeof data.pagination?.total === 'number' ? data.pagination.total : null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  async function handleMarkRead(notificationId: string) {
    setActingId(notificationId);
    setActionMessage(null);
    setError(null);

    try {
      const response = await apiFetch(`/api/notifications/${notificationId}`, {
        method: 'PATCH',
      });
      const data = (await response.json().catch(() => null)) as {
        success?: boolean;
        notification?: NotificationRecord;
        error?: string;
        message?: string;
      } | null;

      if (!response.ok || data?.success !== true || !data.notification) {
        throw new Error(data?.error || data?.message || 'Failed to mark notification read');
      }

      setNotifications((current) =>
        current.map((notification) =>
          notification.id === notificationId ? data.notification! : notification
        )
      );
      setActionMessage('Notification marked read.');
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : 'Failed to mark notification read'
      );
    } finally {
      setActingId(null);
    }
  }

  async function handleMarkAllRead() {
    setMarkingAllRead(true);
    setActionMessage(null);
    setError(null);

    try {
      const response = await apiFetch('/api/notifications/read-all', {
        method: 'POST',
      });
      const data = (await response.json().catch(() => null)) as {
        success?: boolean;
        updated?: number;
        error?: string;
        message?: string;
      } | null;

      if (!response.ok || data?.success !== true) {
        throw new Error(data?.error || data?.message || 'Failed to mark notifications read');
      }

      await fetchNotifications();
      setActionMessage(`Marked ${data.updated ?? 0} notifications read.`);
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : 'Failed to mark notifications read'
      );
    } finally {
      setMarkingAllRead(false);
    }
  }

  async function handleDelete(notificationId: string) {
    setActingId(notificationId);
    setActionMessage(null);
    setError(null);

    try {
      const response = await apiFetch(`/api/notifications/${notificationId}`, {
        method: 'DELETE',
      });
      const data = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        message?: string;
      } | null;

      if (!response.ok || data?.success !== true) {
        throw new Error(data?.error || data?.message || 'Failed to delete notification');
      }

      setNotifications((current) =>
        current.filter((notification) => notification.id !== notificationId)
      );
      setTotalCount((current) =>
        typeof current === 'number' ? Math.max(0, current - 1) : current
      );
      setActionMessage('Notification deleted.');
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : 'Failed to delete notification'
      );
    } finally {
      setActingId(null);
    }
  }

  const unreadNotifications = notifications.filter(isUnreadNotification);
  const readNotifications = notifications.filter((notification) => Boolean(notification.readAt));
  const todayCount = notifications.filter((notification) =>
    isTodaySafe(notification.createdAt)
  ).length;
  const attentionCount = notifications.filter(
    (notification) => notification.status === 'failed' || notification.status === 'pending'
  ).length;

  const filteredNotifications =
    activeTab === 'unread'
      ? unreadNotifications
      : activeTab === 'read'
        ? readNotifications
        : notifications;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => void fetchNotifications()}
          disabled={loading}
          aria-label="Refresh notifications"
          title="Refresh notifications"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          onClick={() => void handleMarkAllRead()}
          disabled={markingAllRead || unreadNotifications.length === 0}
        >
          <CheckCircle2 className="mr-2 h-4 w-4" />
          Mark All Read
        </Button>
        {actionMessage ? <p className="text-sm text-success">{actionMessage}</p> : null}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('stats.all')}</CardTitle>
            <Bell className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCount ?? notifications.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('stats.unread')}</CardTitle>
            <Badge variant="secondary">{unreadNotifications.length}</Badge>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{unreadNotifications.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('stats.today')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{todayCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('stats.important')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{attentionCount}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (value === 'all' || value === 'unread' || value === 'read') {
            setActiveTab(value);
          }
        }}
      >
        <TabsList>
          <TabsTrigger value="all">
            {t('tabs.all', { count: totalCount ?? notifications.length })}
          </TabsTrigger>
          <TabsTrigger value="unread">
            {t('tabs.unread', { count: unreadNotifications.length })}
          </TabsTrigger>
          <TabsTrigger value="read">
            {t('tabs.read', { count: readNotifications.length })}
          </TabsTrigger>
        </TabsList>

        <div className="mt-6 space-y-3">
          {error && (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="flex items-center gap-3 py-4 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </CardContent>
            </Card>
          )}

          {loading && notifications.length === 0 ? (
            Array.from({ length: 3 }).map((_, index) => (
              <Card key={index}>
                <CardHeader className="space-y-3">
                  <div className="h-4 w-48 rounded bg-muted" />
                  <div className="h-3 w-full max-w-xl rounded bg-muted" />
                </CardHeader>
              </Card>
            ))
          ) : filteredNotifications.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center text-muted-foreground">
                <Bell className="h-8 w-8" />
                <p className="text-sm">No notifications</p>
              </CardContent>
            </Card>
          ) : (
            filteredNotifications.map((notification) => (
              <NotificationCard
                key={notification.id}
                notification={notification}
                isUnread={isUnreadNotification(notification)}
                newLabel={t('badge.new')}
                acting={actingId === notification.id}
                onMarkRead={() => void handleMarkRead(notification.id)}
                onDelete={() => void handleDelete(notification.id)}
              />
            ))
          )}
        </div>
      </Tabs>
    </div>
  );
}

function NotificationCard({
  notification,
  isUnread,
  newLabel,
  acting,
  onMarkRead,
  onDelete,
}: {
  notification: NotificationRecord;
  isUnread: boolean;
  newLabel: string;
  acting: boolean;
  onMarkRead: () => void;
  onDelete: () => void;
}) {
  const title = notification.subject || formatNotificationType(notification.type);
  const time = formatNotificationTime(notification.sentAt || notification.createdAt);
  const tone = getNotificationTone(notification, isUnread);

  return (
    <Card className={`transition-colors ${tone}`}>
      <CardHeader className="pb-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
            {getNotificationIcon(notification)}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="break-words text-base">{title}</CardTitle>
              {isUnread && (
                <Badge variant="default" className="h-5">
                  {newLabel}
                </Badge>
              )}
              <Badge variant={getStatusVariant(notification.status)}>
                {formatStatus(notification.status)}
              </Badge>
              <Badge variant="outline">{formatChannel(notification.channel)}</Badge>
            </div>
            <CardDescription className="break-words text-sm leading-6">
              {notification.body}
            </CardDescription>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{formatNotificationType(notification.type)}</span>
              {time && <span>{time}</span>}
              {notification.error && <span className="text-destructive">{notification.error}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {isUnread && (
                <Button size="sm" variant="outline" disabled={acting} onClick={onMarkRead}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Mark Read
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={acting} onClick={onDelete}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}

function isUnreadNotification(notification: NotificationRecord): boolean {
  return (
    notification.channel === 'in_app' &&
    notification.status === 'sent' &&
    notification.readAt === null
  );
}

function isTodaySafe(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && isToday(date);
}

function formatNotificationTime(value: string | null): string {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return formatDistanceToNow(date, { addSuffix: true });
}

function getNotificationTone(notification: NotificationRecord, isUnread: boolean): string {
  if (notification.status === 'failed') {
    return 'border-destructive/40 bg-destructive/5';
  }

  if (isUnread) {
    return 'border-l-4 border-l-primary bg-primary/5';
  }

  if (notification.status === 'pending') {
    return 'border-yellow-500/30 bg-yellow-500/5';
  }

  return '';
}

function getNotificationIcon(notification: NotificationRecord) {
  if (notification.status === 'failed') {
    return <AlertCircle className="h-4 w-4 text-destructive" />;
  }

  if (notification.status === 'pending') {
    return <Clock className="h-4 w-4 text-yellow-600" />;
  }

  if (
    notification.type.includes('critical') ||
    notification.type.includes('warning') ||
    notification.type.includes('exceeded')
  ) {
    return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
  }

  if (notification.type.includes('success') || notification.type.includes('upgraded')) {
    return <CheckCircle2 className="h-4 w-4 text-success" />;
  }

  if (notification.channel === 'email') {
    return <Mail className="h-4 w-4 text-primary" />;
  }

  if (notification.channel === 'webhook') {
    return <Webhook className="h-4 w-4 text-primary" />;
  }

  return <Info className="h-4 w-4 text-primary" />;
}

function getStatusVariant(status: NotificationRecord['status']) {
  if (status === 'failed') {
    return 'destructive';
  }

  if (status === 'sent') {
    return 'secondary';
  }

  return 'outline';
}

function formatStatus(status: NotificationRecord['status']): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatChannel(channel: NotificationRecord['channel']): string {
  if (channel === 'in_app') {
    return 'In-app';
  }

  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

function formatNotificationType(type: string): string {
  return type
    .split(/[._-]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
