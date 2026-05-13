'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MoreHorizontal, Edit, DollarSign, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import type { SKUWithDetails } from '@/hooks/use-billing';

interface SKUsTableProps {
  skus: SKUWithDetails[];
  loading: boolean;
  onEdit?: (sku: SKUWithDetails) => void;
  onRefresh?: () => void;
}

export function SKUsTable({ skus, loading, onEdit, onRefresh }: SKUsTableProps) {
  const t = useTranslations('dashboard.billing.skusTable');
  const { toast } = useToast();
  const [syncing, setSyncing] = useState<string | null>(null);

  const handleSyncStripe = async (sku: SKUWithDetails) => {
    setSyncing(sku.id);

    try {
      const response = await fetch(`/api/billing/skus/${sku.id}/sync-stripe`, {
        method: 'POST',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t('toast.syncFailed'));
      }

      toast({
        title: t('toast.syncSuccess.title'),
        description: t('toast.syncSuccess.description', { name: sku.name }),
      });

      onRefresh?.();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('toast.syncFailed');
      toast({
        title: t('toast.error'),
        description: message,
        variant: 'error',
      });
    } finally {
      setSyncing(null);
    }
  };

  const formatPrice = (price: string, _currency: string, interval: string | null) => {
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(parseFloat(price));

    if (interval) {
      const intervalAbbr = interval === 'yearly' ? t('intervals.yr') : t(`intervals.${interval}`);
      return `${formatted}/${intervalAbbr}`;
    }
    return formatted;
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('columns.sku')}</TableHead>
            <TableHead>{t('columns.product')}</TableHead>
            <TableHead>{t('columns.plan')}</TableHead>
            <TableHead>{t('columns.price')}</TableHead>
            <TableHead>{t('columns.stripe')}</TableHead>
            <TableHead>{t('columns.status')}</TableHead>
            <TableHead className="w-[70px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            [...Array(3)].map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={7}>
                  <div className="h-12 w-full bg-muted animate-pulse rounded" />
                </TableCell>
              </TableRow>
            ))
          ) : skus.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                {t('empty')}
              </TableCell>
            </TableRow>
          ) : (
            skus.map((sku) => (
              <TableRow key={sku.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success-100 text-success">
                      <DollarSign className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-medium">{sku.name}</div>
                      <div className="text-sm text-muted-foreground">{sku.slug}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm">{sku.product?.name || t('notAvailable')}</span>
                </TableCell>
                <TableCell>
                  <span className="text-sm">{sku.plan?.name || t('notAvailable')}</span>
                </TableCell>
                <TableCell>
                  <div className="font-medium">
                    {formatPrice(sku.price, sku.currency, sku.billingInterval)}
                  </div>
                </TableCell>
                <TableCell>
                  {sku.stripePriceId ? (
                    <Badge variant="outline" className="text-xs">
                      {t('stripe.synced')}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">
                      {t('stripe.notSynced')}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={sku.isActive ? 'default' : 'secondary'}>
                    {sku.isActive ? t('status.active') : t('status.inactive')}
                  </Badge>
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>{t('actions.title')}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => onEdit?.(sku)}>
                        <Edit className="mr-2 h-4 w-4" />
                        {t('actions.edit')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleSyncStripe(sku)}
                        disabled={syncing === sku.id}
                      >
                        <ExternalLink className="mr-2 h-4 w-4" />
                        {syncing === sku.id ? t('actions.syncing') : t('actions.syncToStripe')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
