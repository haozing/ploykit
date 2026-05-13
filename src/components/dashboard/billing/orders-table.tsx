'use client';

import { useTranslations } from 'next-intl';
import { ShoppingCart } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { OrderWithDetails } from '@/hooks/use-billing';
import { formatDistanceToNow } from 'date-fns';

interface OrdersTableProps {
  orders: OrderWithDetails[];
  loading: boolean;
}

export function OrdersTable({ orders, loading }: OrdersTableProps) {
  const t = useTranslations('dashboard.billing.ordersTable');
  const getStatusVariant = (status: string): 'default' | 'secondary' | 'destructive' => {
    if (status === 'completed') return 'default';
    if (status === 'failed' || status === 'cancelled') return 'destructive';
    return 'secondary';
  };

  const formatPrice = (amount: string, _currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(parseFloat(amount));
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('columns.order')}</TableHead>
            <TableHead>{t('columns.user')}</TableHead>
            <TableHead>{t('columns.sku')}</TableHead>
            <TableHead>{t('columns.amount')}</TableHead>
            <TableHead>{t('columns.status')}</TableHead>
            <TableHead>{t('columns.date')}</TableHead>
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
          ) : orders.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                {t('empty')}
              </TableCell>
            </TableRow>
          ) : (
            orders.map((order) => (
              <TableRow key={order.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary">
                      <ShoppingCart className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-medium">{order.orderNumber}</div>
                      <div className="text-sm text-muted-foreground">
                        {t('quantity', { qty: order.quantity })}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm">{order.userId}</span>
                </TableCell>
                <TableCell>
                  <span className="text-sm">{order.sku?.name || t('notAvailable')}</span>
                </TableCell>
                <TableCell>
                  <div className="font-medium">{formatPrice(order.total, order.currency)}</div>
                </TableCell>
                <TableCell>
                  <Badge variant={getStatusVariant(order.status)} className="capitalize">
                    {t(`status.${order.status}`)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(order.createdAt), { addSuffix: true })}
                  </span>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
