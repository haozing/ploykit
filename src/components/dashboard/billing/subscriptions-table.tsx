'use client';

import { useTranslations } from 'next-intl';
import { Repeat } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { SubscriptionWithDetails } from '@/hooks/use-billing';
import { format, formatDistanceToNow } from 'date-fns';

interface SubscriptionsTableProps {
  subscriptions: SubscriptionWithDetails[];
  loading: boolean;
}

export function SubscriptionsTable({ subscriptions, loading }: SubscriptionsTableProps) {
  const t = useTranslations('dashboard.billing.subscriptionsTable');
  const getStatusVariant = (status: string): 'default' | 'secondary' | 'destructive' => {
    if (status === 'active') return 'default';
    if (status === 'cancelled') return 'destructive';
    return 'secondary';
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('columns.subscription')}</TableHead>
            <TableHead>{t('columns.user')}</TableHead>
            <TableHead>{t('columns.sku')}</TableHead>
            <TableHead>{t('columns.interval')}</TableHead>
            <TableHead>{t('columns.currentPeriod')}</TableHead>
            <TableHead>{t('columns.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            [...Array(5)].map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={6}>
                  <div className="h-12 w-full bg-muted animate-pulse rounded" />
                </TableCell>
              </TableRow>
            ))
          ) : subscriptions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                {t('empty')}
              </TableCell>
            </TableRow>
          ) : (
            subscriptions.map((sub) => (
              <TableRow key={sub.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 text-purple-600">
                      <Repeat className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-medium text-sm">{sub.id.slice(0, 8)}...</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(sub.createdAt), { addSuffix: true })}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm">{sub.userId}</span>
                </TableCell>
                <TableCell>
                  <span className="text-sm">{sub.sku?.name || t('notAvailable')}</span>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize">
                    {t(`interval.${sub.billingInterval}`)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="text-sm">
                    <div>{format(new Date(sub.currentPeriodStart), 'MMM d, yyyy')}</div>
                    <div className="text-muted-foreground">
                      {t('to')} {format(new Date(sub.currentPeriodEnd), 'MMM d, yyyy')}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <Badge variant={getStatusVariant(sub.status)} className="capitalize">
                      {t(`status.${sub.status}`)}
                    </Badge>
                    {sub.cancelAtPeriodEnd && (
                      <div className="text-xs text-muted-foreground">{t('cancelAtPeriodEnd')}</div>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
