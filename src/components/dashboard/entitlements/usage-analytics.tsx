'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { BarChart3, Crown, TrendingUp, Users } from 'lucide-react';
import { apiFetch } from '@/lib/shared/auth-client';
import type { EntitlementStats, PlanWithSubscribers } from '@/hooks/use-entitlements';

/**
 * Usage Analytics Interfaces (refactor foundation)
 */
interface UsageData {
  rangeDays: number;
  startAt: string;
  endAt: string;
  totalEvents: number;
  topMetrics: Array<{ key: string; total: number }>;
  topUsers: Array<{
    userId: string;
    userName: string | null;
    userEmail: string | null;
    total: number;
  }>;
}

/**
 * Usage Analytics Component
 *
 * Displays:
 * - Stats cards (moved from page header area)
 * - Active subscribers by plan
 * - Top usage metrics (from usage_history)
 */
interface UsageAnalyticsProps {
  stats: EntitlementStats | null;
  statsLoading: boolean;
  plans: PlanWithSubscribers[];
}

export function UsageAnalytics({ stats, statsLoading, plans }: UsageAnalyticsProps) {
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true); // usage fetch loading
  const params = useParams();
  const lang = params.lang as string;
  const t = useTranslations('dashboard.entitlements');
  const tPage = useTranslations('dashboard.entitlements.page');

  const fetchUsageData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch('/api/admin/entitlements/usage');

      if (!response.ok) {
        throw new Error(`Failed to fetch usage data: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success && result.data) {
        setUsageData(result.data);
      } else {
        console.error('Failed to fetch usage data:', result.error);
        setUsageData(null);
      }
    } catch (error) {
      console.error('Error fetching usage data:', error);
      setUsageData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsageData();
  }, [fetchUsageData]);

  const plansSorted = useMemo(() => {
    return [...plans].sort((a, b) => (b.subscriberCount || 0) - (a.subscriberCount || 0));
  }, [plans]);

  const maxSubscribers = useMemo(() => {
    return Math.max(1, ...plansSorted.map((p) => p.subscriberCount || 0));
  }, [plansSorted]);

  const formatNumber = (value: number) =>
    new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
      maximumFractionDigits: 0,
    }).format(value);

  return (
    <div className="space-y-6">
      {/* Stats Cards (moved from top of page) */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription>{tPage('stats.totalPlans')}</CardDescription>
              <Crown className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <div className="h-7 w-20 bg-muted animate-pulse rounded" />
            ) : (
              <div className="text-2xl font-bold">{stats?.plans.total ?? 0}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription>{tPage('stats.activeSubscriptions')}</CardDescription>
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <div className="h-7 w-20 bg-muted animate-pulse rounded" />
            ) : (
              <div className="text-2xl font-bold">{stats?.subscriptions.active ?? 0}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription>{tPage('stats.trialSubscriptions')}</CardDescription>
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <div className="h-7 w-20 bg-muted animate-pulse rounded" />
            ) : (
              <div className="text-2xl font-bold">{stats?.subscriptions.trial ?? 0}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription>{tPage('stats.monthlyRevenue')}</CardDescription>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <div className="h-7 w-20 bg-muted animate-pulse rounded" />
            ) : (
              <div className="text-2xl font-bold">{stats?.revenue.formatted ?? '$0'}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('analytics.sections.subscribersByPlan.title')}</CardTitle>
            <CardDescription>
              {t('analytics.sections.subscribersByPlan.description')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {plansSorted.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6">
                {t('analytics.emptyState.noPlans')}
              </p>
            ) : (
              <div className="space-y-3">
                {plansSorted.slice(0, 8).map((plan) => {
                  const pct = Math.round(((plan.subscriberCount || 0) / maxSubscribers) * 100);
                  return (
                    <div key={plan.id} className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Crown className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium truncate">{plan.name}</span>
                        </div>
                        <span className="text-sm text-muted-foreground whitespace-nowrap">
                          {formatNumber(plan.subscriberCount || 0)} {t('plansTable.units.users')}
                        </span>
                      </div>
                      <Progress value={pct} className="h-2" />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('analytics.sections.topMetrics.title')}</CardTitle>
            <CardDescription>
              {loading
                ? t('analytics.sections.topMetrics.loading')
                : t('analytics.sections.topMetrics.description', {
                    days: usageData?.rangeDays ?? 30,
                  })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-4 w-full bg-muted animate-pulse rounded" />
                ))}
              </div>
            ) : usageData?.topMetrics?.length ? (
              <div className="space-y-3">
                {usageData.topMetrics.map((m) => (
                  <div key={m.key} className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 min-w-0">
                      <BarChart3 className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-mono text-xs truncate" title={m.key}>
                        {m.key}
                      </span>
                    </div>
                    <span className="text-sm font-medium whitespace-nowrap">
                      {formatNumber(m.total)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-6">
                {t('analytics.emptyState.noUsage')}
              </p>
            )}

            {!loading && usageData?.topUsers?.length ? (
              <div className="mt-6 border-t pt-4">
                <div className="text-sm font-medium mb-3">
                  {t('analytics.sections.topUsers.title')}
                </div>
                <div className="space-y-2">
                  {usageData.topUsers.map((u) => (
                    <div key={u.userId} className="flex items-center justify-between gap-4">
                      <span className="text-sm truncate">
                        {u.userName || u.userEmail || u.userId}
                      </span>
                      <span className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatNumber(u.total)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
