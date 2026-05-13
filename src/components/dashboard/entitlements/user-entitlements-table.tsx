'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  MoreHorizontal,
  Eye,
  Edit,
  Trash2,
  User,
  Calendar,
  Loader2,
  RotateCcw,
} from 'lucide-react';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ChangePlanDialog } from './change-plan-dialog';
import type { UserEntitlementWithDetails, PlanWithSubscribers } from '@/hooks/use-entitlements';
import type { Pagination } from '@/hooks/types/common';
import { useToast } from '@/hooks/use-toast';
import { useTranslations } from 'next-intl';

/**
 * User Entitlements Table Props
 */
interface UserEntitlementsTableProps {
  entitlements: UserEntitlementWithDetails[];
  loading: boolean;
  pagination?: Pagination | null;
  plans: PlanWithSubscribers[];
  onPageChange?: (page: number) => void;
  onRefresh?: () => void;
}

/**
 * User Entitlements Table Component
 *
 * Displays user subscriptions with:
 * - User name/email and plan
 * - Subscription status
 * - Start and end dates
 * - Usage metrics
 * - Actions menu
 */
export function UserEntitlementsTable({
  entitlements,
  loading,
  pagination,
  plans,
  onPageChange,
  onRefresh,
}: UserEntitlementsTableProps) {
  const params = useParams();
  const lang = params.lang as string;
  const { toast } = useToast();
  const t = useTranslations('dashboard.entitlements.userTable');

  // Change Plan Dialog State
  const [changePlanDialogOpen, setChangePlanDialogOpen] = useState(false);
  const [selectedEntitlement, setSelectedEntitlement] = useState<UserEntitlementWithDetails | null>(
    null
  );

  // Cancel Subscription Dialog State
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  // Handlers
  const handleChangePlan = (entitlement: UserEntitlementWithDetails) => {
    setSelectedEntitlement(entitlement);
    setChangePlanDialogOpen(true);
  };

  const handleCancelSubscription = (entitlement: UserEntitlementWithDetails) => {
    setSelectedEntitlement(entitlement);
    setCancelDialogOpen(true);
  };

  const handleReactivateSubscription = async (entitlement: UserEntitlementWithDetails) => {
    setReactivatingId(entitlement.id);

    try {
      const response = await fetch(`/api/admin/entitlements/${entitlement.userId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          entitlementId: entitlement.id,
          status: 'reactivate',
          notes: 'Subscription reactivated by admin',
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || t('toast.reactivatedDescription'));
      }

      toast({
        title: t('toast.reactivated'),
        description: t('toast.reactivatedDescription', {
          userName: entitlement.userName || entitlement.userEmail,
        }),
      });

      onRefresh?.();
    } catch (error) {
      console.error('Reactivate subscription error:', error);
      toast({
        title: t('toast.error'),
        description: error instanceof Error ? error.message : t('toast.reactivatedDescription'),
        variant: 'error',
      });
    } finally {
      setReactivatingId(null);
    }
  };

  const confirmCancelSubscription = async () => {
    if (!selectedEntitlement) return;

    setCancellingId(selectedEntitlement.id);

    try {
      const response = await fetch(`/api/admin/entitlements/${selectedEntitlement.userId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          entitlementId: selectedEntitlement.id,
          planId: selectedEntitlement.plan.id,
          status: 'cancelled',
          notes: 'Subscription cancelled by admin',
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || t('toast.cancelledDescription'));
      }

      toast({
        title: t('toast.cancelled'),
        description: t('toast.cancelledDescription', {
          userName: selectedEntitlement.userName || selectedEntitlement.userEmail,
        }),
      });

      setCancelDialogOpen(false);
      onRefresh?.();
    } catch (error) {
      console.error('Cancel subscription error:', error);
      toast({
        title: t('toast.error'),
        description: error instanceof Error ? error.message : t('toast.cancelledDescription'),
        variant: 'error',
      });
    } finally {
      setCancellingId(null);
      setSelectedEntitlement(null);
    }
  };

  const formatPrice = (entitlement: UserEntitlementWithDetails) => {
    const plan = entitlement.plan;
    const pricing = plan.pricing || {};

    const billingInterval = entitlement.billingInterval === 'yearly' ? 'yearly' : 'monthly';

    const amount = pricing[billingInterval] ?? 0;
    const currency = pricing.currency || 'USD';

    if (!amount) return t('plan.free');

    const formatted = new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
    }).format(amount);

    const suffix = billingInterval === 'monthly' ? 'mo' : 'yr';
    return `${formatted}/${suffix}`;
  };

  const getStatusColor = (status: string): 'default' | 'secondary' | 'outline' => {
    switch (status.toLowerCase()) {
      case 'active':
        return 'default';
      case 'trial':
        return 'secondary';
      case 'expired':
        return 'outline';
      case 'cancelled':
        return 'outline';
      default:
        return 'secondary';
    }
  };

  const getStatusLabel = (status: string): string => {
    switch (status.toLowerCase()) {
      case 'active':
        return t('status.active');
      case 'trial':
        return t('status.trial');
      case 'expired':
        return t('status.expired');
      case 'cancelled':
        return t('status.cancelled');
      default:
        return status;
    }
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('columns.user')}</TableHead>
            <TableHead>{t('columns.plan')}</TableHead>
            <TableHead>{t('columns.status')}</TableHead>
            <TableHead>{t('columns.duration')}</TableHead>
            <TableHead className="w-[70px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            // Loading skeleton
            [...Array(5)].map((_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-muted animate-pulse" />
                    <div className="space-y-2">
                      <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                      <div className="h-3 w-24 bg-muted animate-pulse rounded" />
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-2">
                    <div className="h-4 w-20 bg-muted animate-pulse rounded" />
                    <div className="h-3 w-16 bg-muted animate-pulse rounded" />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="h-6 w-16 bg-muted animate-pulse rounded" />
                </TableCell>
                <TableCell>
                  <div className="space-y-2">
                    <div className="h-3 w-28 bg-muted animate-pulse rounded" />
                    <div className="h-3 w-32 bg-muted animate-pulse rounded" />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="h-8 w-8 bg-muted animate-pulse rounded" />
                </TableCell>
              </TableRow>
            ))
          ) : entitlements.length === 0 ? (
            // Empty state
            <TableRow>
              <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                {t('emptyState')}
              </TableCell>
            </TableRow>
          ) : (
            // Actual data
            entitlements.map((entitlement) => (
              <TableRow key={entitlement.id}>
                {/* User */}
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <User className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-medium">{entitlement.userName || 'Unknown'}</div>
                      <div className="text-sm text-muted-foreground">{entitlement.userEmail}</div>
                    </div>
                  </div>
                </TableCell>

                {/* Plan */}
                <TableCell>
                  <div>
                    <div className="font-medium">{entitlement.plan.name}</div>
                    <div className="text-sm text-muted-foreground">{formatPrice(entitlement)}</div>
                  </div>
                </TableCell>

                {/* Status */}
                <TableCell>
                  <Badge variant={getStatusColor(entitlement.status)}>
                    {getStatusLabel(entitlement.status)}
                  </Badge>
                </TableCell>

                {/* Duration */}
                <TableCell>
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-3 w-3 text-muted-foreground" />
                      <span>
                        {t('duration.started')} {entitlement.startDate}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">{entitlement.daysInfo}</div>
                  </div>
                </TableCell>

                {/* Actions */}
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Open menu</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>{t('columns.actions')}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <Link href={`/${lang}/admin/users/${entitlement.userId}`}>
                          <Eye className="mr-2 h-4 w-4" />
                          {t('actions.viewUser')}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleChangePlan(entitlement)}>
                        <Edit className="mr-2 h-4 w-4" />
                        {t('actions.changePlan')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => void handleReactivateSubscription(entitlement)}
                        disabled={
                          entitlement.status !== 'cancelled' || reactivatingId === entitlement.id
                        }
                      >
                        {reactivatingId === entitlement.id ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <RotateCcw className="mr-2 h-4 w-4" />
                        )}
                        {t('actions.reactivateSubscription')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => handleCancelSubscription(entitlement)}
                        disabled={entitlement.status === 'cancelled'}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t('actions.cancelSubscription')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {/* Pagination */}
      <div className="flex items-center justify-between border-t px-4 py-4">
        <div className="text-sm text-muted-foreground">
          {loading ? (
            <div className="h-4 w-48 bg-muted animate-pulse rounded" />
          ) : pagination ? (
            <>
              {t('pagination.showing')}{' '}
              <strong>
                {(pagination.page - 1) * pagination.limit + 1}-
                {Math.min(pagination.page * pagination.limit, pagination.total)}
              </strong>{' '}
              {t('pagination.of')} <strong>{pagination.total}</strong>{' '}
              {t('pagination.subscriptions')}
            </>
          ) : (
            <>
              {t('pagination.showing')} <strong>{entitlements.length}</strong>{' '}
              {t('pagination.subscriptions')}
            </>
          )}
        </div>
        {pagination && pagination.totalPages > 1 && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1 || loading}
              onClick={() => onPageChange?.(pagination.page - 1)}
            >
              {t('pagination.previous')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages || loading}
              onClick={() => onPageChange?.(pagination.page + 1)}
            >
              {t('pagination.next')}
            </Button>
          </div>
        )}
      </div>

      {/* Change Plan Dialog */}
      {selectedEntitlement && (
        <ChangePlanDialog
          open={changePlanDialogOpen}
          onOpenChange={setChangePlanDialogOpen}
          userId={selectedEntitlement.userId}
          userName={selectedEntitlement.userName || selectedEntitlement.userEmail}
          currentPlanId={selectedEntitlement.plan.id}
          currentPlanName={selectedEntitlement.plan.name}
          plans={plans}
          onSuccess={() => {
            onRefresh?.();
            setSelectedEntitlement(null);
          }}
        />
      )}

      {/* Cancel Subscription Confirmation Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cancelDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('cancelDialog.description', {
                userName: selectedEntitlement?.userName || selectedEntitlement?.userEmail || '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!cancellingId}>
              {t('cancelDialog.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmCancelSubscription}
              disabled={!!cancellingId}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancellingId && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {cancellingId ? t('cancelDialog.cancelling') : t('cancelDialog.yes')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
