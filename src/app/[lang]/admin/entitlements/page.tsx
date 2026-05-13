'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search } from 'lucide-react';
import { PlansTable } from '@/components/dashboard/entitlements/plans-table';
import { PlanDialog } from '@/components/dashboard/entitlements/plan-dialog';
import { UserEntitlementsTable } from '@/components/dashboard/entitlements/user-entitlements-table';
import { UsageAnalytics } from '@/components/dashboard/entitlements/usage-analytics';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useEntitlements } from '@/hooks/use-entitlements';
import type { PlanWithSubscribers } from '@/hooks/use-entitlements';

/**
 * Entitlements Management Page
 *
 * Features:
 * - Manage subscription plans (Free, Pro, Enterprise)
 * - View user entitlements
 * - Track user-level usage
 * - Configure plan features and limits
 */
export default function EntitlementsPage() {
  const t = useTranslations('dashboard.entitlements.page');

  const {
    stats,
    plans,
    userEntitlements,
    pagination,
    statsLoading,
    plansLoading,
    entitlementsLoading,
    fetchUserEntitlements,
    fetchPlans,
  } = useEntitlements();

  // Tab state
  const [activeTab, setActiveTab] = useState('plans');

  // Plan dialog state
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [selectedPlanForEdit, setSelectedPlanForEdit] = useState<PlanWithSubscribers | null>(null);

  // Filters for user entitlements
  const [search, setSearch] = useState('');
  const [selectedPlan, setSelectedPlan] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');

  // Handle filter changes
  const handleSearchChange = (value: string) => {
    setSearch(value);
    fetchUserEntitlements({ search: value, planId: selectedPlan, status: selectedStatus });
  };

  const handlePlanChange = (value: string) => {
    setSelectedPlan(value);
    fetchUserEntitlements({ search, planId: value, status: selectedStatus });
  };

  const handleStatusChange = (value: string) => {
    setSelectedStatus(value);
    fetchUserEntitlements({ search, planId: selectedPlan, status: value });
  };

  const handlePageChange = (page: number) => {
    fetchUserEntitlements({ search, planId: selectedPlan, status: selectedStatus, page });
  };

  // Handle plan dialog actions
  const handleCreatePlan = () => {
    setSelectedPlanForEdit(null);
    setPlanDialogOpen(true);
  };

  const handleEditPlan = (plan: PlanWithSubscribers) => {
    setSelectedPlanForEdit(plan);
    setPlanDialogOpen(true);
  };

  const handlePlanDialogClose = () => {
    setPlanDialogOpen(false);
    setSelectedPlanForEdit(null);
  };

  const handlePlanSuccess = () => {
    fetchPlans(); // Refresh plans list
  };

  // Handle view subscribers - switch to entitlements tab and filter by plan
  const handleViewSubscribers = (planId: string) => {
    setSelectedPlan(planId);
    setActiveTab('entitlements');
    fetchUserEntitlements({ search, planId, status: selectedStatus });
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <Button onClick={handleCreatePlan}>
          <Plus className="mr-2 h-4 w-4" />
          {t('actions.createPlan')}
        </Button>
      </div>

      {/* Tabs for Plans vs User Entitlements */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="plans">{t('tabs.plans')}</TabsTrigger>
          <TabsTrigger value="entitlements">{t('tabs.entitlements')}</TabsTrigger>
          <TabsTrigger value="usage">{t('tabs.usage')}</TabsTrigger>
        </TabsList>

        {/* Plans Tab */}
        <TabsContent value="plans" className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <PlansTable
                plans={plans}
                loading={plansLoading}
                onEditPlan={handleEditPlan}
                onDeletePlan={fetchPlans}
                onViewSubscribers={handleViewSubscribers}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Entitlements Tab */}
        <TabsContent value="entitlements" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('userCard.title')}</CardTitle>
              <CardDescription>{t('userCard.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    placeholder={t('filters.searchUsers')}
                    className="pl-9"
                    value={search}
                    onChange={(e) => handleSearchChange(e.target.value)}
                  />
                </div>

                <Select value={selectedPlan} onValueChange={handlePlanChange}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('filters.allPlans')}</SelectItem>
                    {plans.map((plan) => (
                      <SelectItem key={plan.id} value={plan.id}>
                        {plan.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={selectedStatus} onValueChange={handleStatusChange}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('filters.allStatus')}</SelectItem>
                    <SelectItem value="active">{t('filters.active')}</SelectItem>
                    <SelectItem value="trial">{t('filters.trial')}</SelectItem>
                    <SelectItem value="expired">{t('filters.expired')}</SelectItem>
                    <SelectItem value="cancelled">{t('filters.cancelled')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <UserEntitlementsTable
                entitlements={userEntitlements}
                loading={entitlementsLoading}
                pagination={pagination}
                plans={plans}
                onPageChange={handlePageChange}
                onRefresh={() =>
                  fetchUserEntitlements({ search, planId: selectedPlan, status: selectedStatus })
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Usage Analytics Tab */}
        <TabsContent value="usage" className="space-y-4">
          <UsageAnalytics stats={stats} statsLoading={statsLoading} plans={plans} />
        </TabsContent>
      </Tabs>

      {/* Plan Dialog */}
      <PlanDialog
        open={planDialogOpen}
        onOpenChange={handlePlanDialogClose}
        plan={selectedPlanForEdit}
        onSuccess={handlePlanSuccess}
      />
    </div>
  );
}
