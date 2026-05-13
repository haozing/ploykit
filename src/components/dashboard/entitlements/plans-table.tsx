'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MoreHorizontal, Eye, Edit, Trash2, Crown, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { useToast } from '@/hooks/use-toast';
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
import type { PlanWithSubscribers } from '@/hooks/use-entitlements';

/**
 * Plans Table Props
 */
interface PlansTableProps {
  plans: PlanWithSubscribers[];
  loading: boolean;
  onEditPlan?: (plan: PlanWithSubscribers) => void;
  onDeletePlan?: () => void;
  onViewSubscribers?: (planId: string) => void;
}

/**
 * Plans Table Component
 *
 * Displays subscription plans with:
 * - Plan name and pricing
 * - Pricing summary
 * - Subscriber count
 * - Actions menu
 */
export function PlansTable({
  plans,
  loading,
  onEditPlan,
  onDeletePlan,
  onViewSubscribers,
}: PlansTableProps) {
  const t = useTranslations('dashboard.entitlements.plansTable');
  const params = useParams();
  const lang = params.lang as string;
  const { toast } = useToast();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [planToDelete, setPlanToDelete] = useState<PlanWithSubscribers | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteClick = (plan: PlanWithSubscribers) => {
    setPlanToDelete(plan);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!planToDelete) return;

    setIsDeleting(true);

    try {
      const response = await fetch(`/api/admin/entitlements/plans/${planToDelete.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t('toast.deletedDescription'));
      }

      toast({
        title: t('toast.deleted'),
        description: t('toast.deletedDescription', { planName: planToDelete.name }),
      });

      onDeletePlan?.();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('toast.deletedDescription');
      toast({
        title: 'Error',
        description: message,
        variant: 'error',
      });
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setPlanToDelete(null);
    }
  };

  const formatPricing = (plan: PlanWithSubscribers) => {
    const pricing = (plan.pricing as Record<string, unknown> | undefined) || {};
    const monthly = pricing.monthly as number | undefined;
    const yearly = pricing.yearly as number | undefined;

    const fmt = (amount: number) =>
      new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
      }).format(amount);

    if ((monthly ?? 0) === 0 && (yearly ?? 0) === 0) return t('pricing.free');

    const parts: string[] = [];
    if (monthly !== undefined) parts.push(`${fmt(monthly)}${t('pricing.perMonth')}`);
    if (yearly !== undefined) parts.push(`${fmt(yearly)}${t('pricing.perYear')}`);

    return parts.join(' · ');
  };

  const getLocalizedPlanText = (plan: PlanWithSubscribers) => {
    const langJsonb = (plan.langJsonb || null) as Record<
      string,
      Record<string, unknown> | undefined
    > | null;
    if (!langJsonb) return { name: plan.name, description: '' };

    const direct = langJsonb[lang];
    const zh = langJsonb.zh || langJsonb['zh-CN'];
    const localized = direct || (lang.startsWith('zh') ? zh : undefined);

    return {
      name: (localized?.name as string | undefined) || plan.name,
      description: (localized?.description as string | undefined) || '',
    };
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('columns.plan')}</TableHead>
            <TableHead>{t('columns.pricing')}</TableHead>
            <TableHead>{t('columns.subscribers')}</TableHead>
            <TableHead>{t('columns.status')}</TableHead>
            <TableHead className="w-[70px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            // Loading skeleton
            [...Array(3)].map((_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-muted animate-pulse" />
                    <div className="space-y-2">
                      <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                      <div className="h-3 w-32 bg-muted animate-pulse rounded" />
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="h-4 w-16 bg-muted animate-pulse rounded" />
                </TableCell>
                <TableCell>
                  <div className="h-4 w-16 bg-muted animate-pulse rounded" />
                </TableCell>
                <TableCell>
                  <div className="h-6 w-16 bg-muted animate-pulse rounded" />
                </TableCell>
                <TableCell>
                  <div className="h-8 w-8 bg-muted animate-pulse rounded" />
                </TableCell>
              </TableRow>
            ))
          ) : plans.length === 0 ? (
            // Empty state
            <TableRow>
              <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                {t('emptyState')}
              </TableCell>
            </TableRow>
          ) : (
            // Actual data
            plans.map((plan) => (
              <TableRow key={plan.id}>
                {/* Plan Info */}
                <TableCell>
                  {(() => {
                    const localized = getLocalizedPlanText(plan);
                    return (
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Crown className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{localized.name}</span>
                            {plan.isDefault && (
                              <Badge variant="outline" className="text-xs">
                                {t('badges.default')}
                              </Badge>
                            )}
                          </div>
                          {localized.description && (
                            <div className="text-sm text-muted-foreground">
                              {localized.description}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </TableCell>

                {/* Pricing */}
                <TableCell>
                  <div className="font-medium">{formatPricing(plan)}</div>
                </TableCell>

                {/* Subscribers */}
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{plan.subscriberCount}</span>
                    <span className="text-sm text-muted-foreground">{t('units.users')}</span>
                  </div>
                </TableCell>

                {/* Status */}
                <TableCell>
                  <Badge variant={plan.isActive ? 'default' : 'secondary'}>
                    {plan.isActive ? t('status.active') : t('status.inactive')}
                  </Badge>
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
                      <DropdownMenuLabel>{t('actions.viewDetails')}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <Link href={`/${lang}/admin/entitlements/${plan.id}`}>
                          <Eye className="mr-2 h-4 w-4" />
                          {t('actions.viewDetails')}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onEditPlan?.(plan)}>
                        <Edit className="mr-2 h-4 w-4" />
                        {t('actions.edit')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onViewSubscribers?.(plan.id)}>
                        <Users className="mr-2 h-4 w-4" />
                        {t('actions.viewSubscribers')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        disabled={plan.isDefault}
                        onClick={() => handleDeleteClick(plan)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t('actions.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <div className="border-t px-4 py-3 text-sm text-muted-foreground">
        {loading ? (
          <div className="h-4 w-48 bg-muted animate-pulse rounded" />
        ) : (
          t('pagination.totalPlans', { count: plans.length })
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteDialog.description', {
                planName: planToDelete?.name ?? '',
                count: planToDelete?.subscriberCount ?? 0,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t('deleteDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? t('deleteDialog.deleting') : t('deleteDialog.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
