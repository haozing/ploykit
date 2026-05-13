'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/shared/auth-client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Mail, Webhook, Bell, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface NotificationHistoryRecord {
  id: string;
  type: string;
  channel: 'email' | 'webhook' | 'in_app';
  recipient: string;
  subject: string | null;
  body: string;
  status: 'pending' | 'sent' | 'failed';
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface NotificationHistoryProps {
  userId: string;
  limit?: number;
}

export function NotificationHistory({ userId, limit = 50 }: NotificationHistoryProps) {
  const t = useTranslations('components.notifications.notificationHistory');

  const [history, setHistory] = React.useState<NotificationHistoryRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedNotification, setSelectedNotification] =
    React.useState<NotificationHistoryRecord | null>(null);

  const fetchHistory = React.useCallback(async () => {
    try {
      setLoading(true);
      const response = await apiFetch(`/api/notifications/history?limit=${limit}`);
      const data = await response.json();

      if (data.success) {
        setHistory(data.history);
      }
    } catch (error) {
      console.error('Error fetching notification history:', error);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  React.useEffect(() => {
    void fetchHistory();
  }, [fetchHistory, userId]);

  const getChannelIcon = (channel: string) => {
    switch (channel) {
      case 'email':
        return <Mail className="h-4 w-4" />;
      case 'webhook':
        return <Webhook className="h-4 w-4" />;
      case 'in_app':
        return <Bell className="h-4 w-4" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'sent':
        return (
          <Badge variant="default" className="bg-success-500">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            {t('statuses.sent')}
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive">
            <XCircle className="mr-1 h-3 w-3" />
            {t('statuses.failed')}
          </Badge>
        );
      case 'pending':
        return (
          <Badge variant="secondary">
            <Clock className="mr-1 h-3 w-3" />
            {t('statuses.pending')}
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatNotificationType = (type: string): string => {
    return type
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description', { count: history.length })}</CardDescription>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">{t('noNotifications')}</div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('type')}</TableHead>
                  <TableHead>{t('channel')}</TableHead>
                  <TableHead>{t('recipient')}</TableHead>
                  <TableHead>{t('subject')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                  <TableHead>{t('sent')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((notification) => (
                  <TableRow
                    key={notification.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedNotification(notification)}
                  >
                    <TableCell className="font-medium">
                      {formatNotificationType(notification.type)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getChannelIcon(notification.channel)}
                        <span className="capitalize">{notification.channel}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {notification.recipient}
                    </TableCell>
                    <TableCell className="max-w-[250px] truncate">
                      {notification.subject || '-'}
                    </TableCell>
                    <TableCell>{getStatusBadge(notification.status)}</TableCell>
                    <TableCell>
                      {notification.sentAt
                        ? formatDistanceToNow(new Date(notification.sentAt), { addSuffix: true })
                        : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Notification Details Modal */}
        {selectedNotification && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setSelectedNotification(null)}
          >
            <Card
              className="max-w-2xl w-full mx-4 max-h-[80vh] overflow-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{t('details')}</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedNotification(null)}>
                    {t('close')}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-muted-foreground">{t('type')}</div>
                  <div className="mt-1">{formatNotificationType(selectedNotification.type)}</div>
                </div>

                <div>
                  <div className="text-sm font-medium text-muted-foreground">{t('channel')}</div>
                  <div className="mt-1 flex items-center gap-2">
                    {getChannelIcon(selectedNotification.channel)}
                    <span className="capitalize">{selectedNotification.channel}</span>
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium text-muted-foreground">{t('status')}</div>
                  <div className="mt-1">{getStatusBadge(selectedNotification.status)}</div>
                </div>

                <div>
                  <div className="text-sm font-medium text-muted-foreground">{t('recipient')}</div>
                  <div className="mt-1">{selectedNotification.recipient}</div>
                </div>

                {selectedNotification.subject && (
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">{t('subject')}</div>
                    <div className="mt-1">{selectedNotification.subject}</div>
                  </div>
                )}

                <div>
                  <div className="text-sm font-medium text-muted-foreground">{t('body')}</div>
                  <div className="mt-1 whitespace-pre-wrap bg-muted p-4 rounded-md text-sm">
                    {selectedNotification.body}
                  </div>
                </div>

                {selectedNotification.error && (
                  <div>
                    <div className="text-sm font-medium text-destructive">{t('error')}</div>
                    <div className="mt-1 text-sm text-destructive">
                      {selectedNotification.error}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">{t('created')}</div>
                    <div className="mt-1 text-sm">
                      {new Date(selectedNotification.createdAt).toLocaleString()}
                    </div>
                  </div>

                  {selectedNotification.sentAt && (
                    <div>
                      <div className="text-sm font-medium text-muted-foreground">{t('sent')}</div>
                      <div className="mt-1 text-sm">
                        {new Date(selectedNotification.sentAt).toLocaleString()}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
