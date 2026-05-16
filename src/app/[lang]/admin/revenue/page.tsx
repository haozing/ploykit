'use client';

import * as React from 'react';
import useSWR from 'swr';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Calendar, DollarSign, RefreshCw, TrendingUp, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiFetch } from '@/lib/shared/auth-client';

type TimeframeKey = '7days' | '30days' | '90days' | '12months';

interface RevenueMetrics {
  mrr: number;
  arr: number;
  revenueByPlan: Record<string, number>;
  revenueGrowth: number;
  averageRevenuePerUser: number;
  lifetimeValue: number;
}

interface RevenueResponse {
  success?: boolean;
  metrics?: RevenueMetrics;
}

function getTimeframeDates(timeframe: TimeframeKey) {
  const endDate = new Date();
  const startDate = new Date(endDate);

  switch (timeframe) {
    case '7days':
      startDate.setDate(endDate.getDate() - 7);
      break;
    case '90days':
      startDate.setDate(endDate.getDate() - 90);
      break;
    case '12months':
      startDate.setMonth(endDate.getMonth() - 12);
      break;
    case '30days':
    default:
      startDate.setDate(endDate.getDate() - 30);
      break;
  }

  const previousEndDate = new Date(startDate);
  const previousStartDate = new Date(previousEndDate);
  previousStartDate.setTime(previousEndDate.getTime() - (endDate.getTime() - startDate.getTime()));

  return { startDate, endDate, previousStartDate, previousEndDate };
}

async function fetchRevenue(url: string): Promise<RevenueMetrics> {
  const response = await apiFetch(url);
  const body = (await response.json().catch(() => null)) as RevenueResponse | null;

  if (!response.ok || body?.success !== true || !body.metrics) {
    throw new Error('Failed to load revenue metrics');
  }

  return body.metrics;
}

export default function RevenuePage() {
  const params = useParams();
  const t = useTranslations('dashboard.revenueMetrics');
  const lang = params.lang === 'zh' ? 'zh' : 'en';
  const [timeframe, setTimeframe] = React.useState<TimeframeKey>('30days');

  const requestUrl = React.useMemo(() => {
    const dates = getTimeframeDates(timeframe);
    const search = new URLSearchParams({
      startDate: dates.startDate.toISOString(),
      endDate: dates.endDate.toISOString(),
      previousStartDate: dates.previousStartDate.toISOString(),
      previousEndDate: dates.previousEndDate.toISOString(),
    });
    return `/api/admin/analytics/revenue?${search.toString()}`;
  }, [timeframe]);

  const { data, error, isLoading, isValidating, mutate } = useSWR(requestUrl, fetchRevenue, {
    revalidateOnFocus: false,
  });

  const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
  const currencyFormatter = React.useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }),
    [locale]
  );
  const numberFormatter = React.useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const maxPlanRevenue = React.useMemo(
    () => Math.max(1, ...Object.values(data?.revenueByPlan ?? {})),
    [data?.revenueByPlan]
  );

  const formatCurrency = React.useCallback(
    (value: number) => currencyFormatter.format(Number.isFinite(value) ? value : 0),
    [currencyFormatter]
  );
  const formatPercentage = React.useCallback((value: number) => {
    const safeValue = Number.isFinite(value) ? value : 0;
    return `${safeValue >= 0 ? '+' : ''}${safeValue.toFixed(1)}%`;
  }, []);

  const planRows = React.useMemo(
    () => Object.entries(data?.revenueByPlan ?? {}).sort((a, b) => b[1] - a[1]),
    [data?.revenueByPlan]
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={timeframe} onValueChange={(value) => setTimeframe(value as TimeframeKey)}>
            <SelectTrigger className="w-[150px]">
              <Calendar className="mr-2 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7days">{t('timeframes.7days')}</SelectItem>
              <SelectItem value="30days">{t('timeframes.30days')}</SelectItem>
              <SelectItem value="90days">{t('timeframes.90days')}</SelectItem>
              <SelectItem value="12months">{t('timeframes.12months')}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void mutate()} disabled={isValidating}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('actions.refresh')}
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle>{t('error.title')}</CardTitle>
            <CardDescription>{t('error.description')}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <RevenueMetricCard
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          label={t('metrics.mrr.label')}
          value={isLoading ? null : formatCurrency(data?.mrr ?? 0)}
          detail={t('metrics.mrr.detail', {
            percentage: formatPercentage(data?.revenueGrowth ?? 0),
          })}
        />
        <RevenueMetricCard
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          label={t('metrics.arr.label')}
          value={isLoading ? null : formatCurrency(data?.arr ?? 0)}
          detail={t('metrics.arr.detail')}
        />
        <RevenueMetricCard
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
          label={t('metrics.arpu.label')}
          value={isLoading ? null : formatCurrency(data?.averageRevenuePerUser ?? 0)}
          detail={t('metrics.arpu.detail')}
        />
        <RevenueMetricCard
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          label={t('metrics.ltv.label')}
          value={isLoading ? null : formatCurrency(data?.lifetimeValue ?? 0)}
          detail={t('metrics.ltv.detail')}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('byPlan.title')}</CardTitle>
          <CardDescription>{t('byPlan.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LoadingRows count={5} />
          ) : planRows.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('byPlan.headers.plan')}</TableHead>
                  <TableHead className="text-right">{t('byPlan.headers.mrr')}</TableHead>
                  <TableHead className="w-[180px] text-right">
                    {t('byPlan.headers.share')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {planRows.map(([planName, planRevenue]) => {
                  const share = data?.mrr ? (planRevenue / data.mrr) * 100 : 0;
                  return (
                    <TableRow key={planName}>
                      <TableCell className="font-medium">{planName}</TableCell>
                      <TableCell className="text-right">{formatCurrency(planRevenue)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-3">
                          <Progress
                            value={(planRevenue / maxPlanRevenue) * 100}
                            className="h-2 w-24"
                          />
                          <span className="w-12 text-sm text-muted-foreground">
                            {numberFormatter.format(Number(share.toFixed(0)))}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
              {t('byPlan.empty')}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RevenueMetricCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  detail: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription>{label}</CardDescription>
        {icon}
      </CardHeader>
      <CardContent>
        {value === null ? (
          <div className="h-8 w-24 animate-pulse rounded bg-muted" />
        ) : (
          <div className="text-2xl font-semibold">{value}</div>
        )}
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      </CardContent>
    </Card>
  );
}

function LoadingRows({ count }: { count: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="h-5 w-full animate-pulse rounded bg-muted" />
      ))}
    </div>
  );
}
