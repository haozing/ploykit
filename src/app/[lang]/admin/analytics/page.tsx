'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Users,
  UserMinus,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  Calendar,
} from 'lucide-react';
import { apiFetch } from '@/lib/shared/auth-client';

interface RevenueMetrics {
  mrr: number;
  arr: number;
  revenueByPlan: Record<string, number>;
  revenueGrowth: number;
  averageRevenuePerUser: number;
  lifetimeValue: number;
}

interface ChurnMetrics {
  churnedUsers: number;
  churnRate: number;
  churnedRevenue: number;
  churnReasons: Record<string, number>;
  retentionRate: number;
  monthlyChurnTrend: Array<{ month: string; count: number; rate: number }>;
}

interface GrowthMetrics {
  newUsers: number;
  trialConversions: number;
  trialConversionRate: number;
  upgrades: number;
  downgrades: number;
  netGrowth: number;
  growthRate: number;
  newTrials: number;
}

interface UsagePatterns {
  metric: string;
  averageUsage: number;
  peakUsage: number;
  medianUsage: number;
  utilizationRate: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  trendPercentage: number;
  distribution: Record<string, number>;
}

interface CohortAnalysis {
  cohort: string;
  size: number;
  retained: number;
  retentionRate: number;
  revenue: number;
  averageLifetime: number;
}

interface ReliabilityMetrics {
  rangeDays: number;
  generatedAt: string;
  reliability: {
    outbox: {
      total: number;
      pending: number;
      processing: number;
      completed: number;
      failed: number;
      readyPending: number;
      failureRate: number;
      oldestFailedAt: string | null;
    };
    webhooks: {
      total: number;
      received: number;
      processing: number;
      processed: number;
      failed: number;
      deadLetter: number;
      retryable: number;
      retryAttempts: number;
      successfulRetryAttempts: number;
      failedRetryAttempts: number;
      failureRate: number;
      oldestFailedAt: string | null;
    };
    jobs: {
      total: number;
      running: number;
      succeeded: number;
      deadLetter: number;
      failureRate: number;
      oldestDeadLetteredAt: string | null;
    };
    overall: {
      totalWorkItems: number;
      failedWorkItems: number;
      backlog: number;
      hasBacklog: boolean;
      failureRate: number;
    };
    trend: Array<{
      day: string;
      outboxFailed: number;
      webhookFailed: number;
      jobFailed: number;
    }>;
    edgeAccess: {
      total: number;
      failed: number;
      failureRate: number;
      p95DurationMs: number;
      byFailureType: Array<{
        failureType: string | null;
        count: number;
      }>;
      activeFailureTypeFilter: string | null;
    };
  };
}

const KNOWN_EDGE_FAILURE_TYPES = ['auth', 'client', 'not_found', 'rate_limited', 'upstream'];

export default function AnalyticsPage() {
  const t = useTranslations('dashboard.analytics.page');
  const [timeframe, setTimeframe] = React.useState('30days');
  const [loading, setLoading] = React.useState(true);
  const [reliabilityFailureType, setReliabilityFailureType] = React.useState('all');

  const [revenue, setRevenue] = React.useState<RevenueMetrics | null>(null);
  const [churn, setChurn] = React.useState<ChurnMetrics | null>(null);
  const [growth, setGrowth] = React.useState<GrowthMetrics | null>(null);
  const [usagePatterns, setUsagePatterns] = React.useState<UsagePatterns[]>([]);
  const [cohorts, setCohorts] = React.useState<CohortAnalysis[]>([]);
  const [reliability, setReliability] = React.useState<ReliabilityMetrics | null>(null);

  const getTimeframeDates = React.useCallback(() => {
    const now = new Date();
    const endDate = now;
    const startDate = new Date();
    let previousStartDate: Date | undefined;
    let previousEndDate: Date | undefined;

    switch (timeframe) {
      case '7days':
        startDate.setDate(now.getDate() - 7);
        previousEndDate = new Date(startDate);
        previousStartDate = new Date(previousEndDate);
        previousStartDate.setDate(previousEndDate.getDate() - 7);
        break;
      case '30days':
        startDate.setDate(now.getDate() - 30);
        previousEndDate = new Date(startDate);
        previousStartDate = new Date(previousEndDate);
        previousStartDate.setDate(previousEndDate.getDate() - 30);
        break;
      case '90days':
        startDate.setDate(now.getDate() - 90);
        previousEndDate = new Date(startDate);
        previousStartDate = new Date(previousEndDate);
        previousStartDate.setDate(previousEndDate.getDate() - 90);
        break;
      case '12months':
        startDate.setMonth(now.getMonth() - 12);
        previousEndDate = new Date(startDate);
        previousStartDate = new Date(previousEndDate);
        previousStartDate.setMonth(previousEndDate.getMonth() - 12);
        break;
    }

    return { startDate, endDate, previousStartDate, previousEndDate };
  }, [timeframe]);

  const fetchAnalytics = React.useCallback(async () => {
    try {
      setLoading(true);
      const { startDate, endDate, previousStartDate, previousEndDate } = getTimeframeDates();

      const params = new URLSearchParams({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });

      if (previousStartDate && previousEndDate) {
        params.append('previousStartDate', previousStartDate.toISOString());
        params.append('previousEndDate', previousEndDate.toISOString());
      }

      const response = await apiFetch(`/api/admin/analytics/dashboard?${params.toString()}`);
      const data = await response.json();

      if (data.success) {
        setRevenue(data.analytics.revenue);
        setChurn(data.analytics.churn);
        setGrowth(data.analytics.growth);
        setUsagePatterns(data.analytics.usagePatterns);
      }

      // Fetch cohorts separately
      const cohortsResponse = await apiFetch('/api/admin/analytics/cohorts?months=12');
      const cohortsData = await cohortsResponse.json();

      if (cohortsData.success) {
        setCohorts(cohortsData.cohorts);
      }

      const reliabilityParams = new URLSearchParams({ days: '30' });
      if (reliabilityFailureType !== 'all') {
        reliabilityParams.set('failureType', reliabilityFailureType);
      }

      const reliabilityResponse = await apiFetch(
        `/api/admin/analytics/reliability?${reliabilityParams.toString()}`
      );
      const reliabilityData = await reliabilityResponse.json();

      if (reliabilityData.success) {
        setReliability({
          rangeDays: reliabilityData.rangeDays,
          generatedAt: reliabilityData.generatedAt,
          reliability: reliabilityData.reliability,
        });
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  }, [getTimeframeDates, reliabilityFailureType]);

  React.useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const reliabilityFailureTypeOptions = React.useMemo(() => {
    const options = new Set(KNOWN_EDGE_FAILURE_TYPES);

    for (const item of reliability?.reliability.edgeAccess.byFailureType ?? []) {
      if (item.failureType) {
        options.add(item.failureType);
      }
    }

    if (reliabilityFailureType !== 'all') {
      options.add(reliabilityFailureType);
    }

    return Array.from(options).sort();
  }, [reliability, reliabilityFailureType]);

  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercentage = (value: number): string => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  };

  const formatNumber = (value: number): string => {
    return new Intl.NumberFormat('en-US').format(value);
  };

  const formatDateTime = (value: string | null): string => {
    if (!value) {
      return 'None';
    }

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  };

  const getTrendIcon = (value: number) => {
    if (value > 0) return <TrendingUp className="h-4 w-4 text-success" />;
    if (value < 0) return <TrendingDown className="h-4 w-4 text-destructive" />;
    return null;
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground mt-2">{t('description')}</p>
        </div>
        <div className="flex gap-4">
          <Select value={timeframe} onValueChange={setTimeframe}>
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
          <Button onClick={fetchAnalytics} variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('actions.refresh')}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
          <TabsTrigger value="revenue">{t('tabs.revenue')}</TabsTrigger>
          <TabsTrigger value="growth">{t('tabs.growth')}</TabsTrigger>
          <TabsTrigger value="churn">{t('tabs.churn')}</TabsTrigger>
          <TabsTrigger value="usage">{t('tabs.usage')}</TabsTrigger>
          <TabsTrigger value="reliability">Reliability</TabsTrigger>
          <TabsTrigger value="cohorts">{t('tabs.cohorts')}</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Revenue Metrics */}
          {revenue && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {t('overview.metrics.mrr.title')}
                  </CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(revenue.mrr)}</div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    {getTrendIcon(revenue.revenueGrowth)}
                    <span>
                      {t('overview.metrics.mrr.fromLastPeriod', {
                        percentage: formatPercentage(revenue.revenueGrowth),
                      })}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {t('overview.metrics.arr.title')}
                  </CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(revenue.arr)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('overview.metrics.arr.description')}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {t('overview.metrics.arpu.title')}
                  </CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {formatCurrency(revenue.averageRevenuePerUser)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('overview.metrics.arpu.description')}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {t('overview.metrics.ltv.title')}
                  </CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(revenue.lifetimeValue)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('overview.metrics.ltv.description')}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Growth & Churn Metrics */}
          {growth && churn && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {t('overview.metrics.newUsers.title')}
                  </CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatNumber(growth.newUsers)}</div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    {getTrendIcon(growth.growthRate)}
                    <span>
                      {t('overview.metrics.newUsers.growthRate', {
                        percentage: formatPercentage(growth.growthRate),
                      })}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {t('overview.metrics.trialConversion.title')}
                  </CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{growth.trialConversionRate.toFixed(1)}%</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('overview.metrics.trialConversion.description', {
                      conversions: growth.trialConversions,
                      trials: growth.newTrials,
                    })}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {t('overview.metrics.churnRate.title')}
                  </CardTitle>
                  <UserMinus className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{churn.churnRate.toFixed(1)}%</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('overview.metrics.churnRate.description', { count: churn.churnedUsers })}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {t('overview.metrics.retentionRate.title')}
                  </CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{churn.retentionRate.toFixed(1)}%</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('overview.metrics.retentionRate.description')}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Revenue by Plan */}
          {revenue && Object.keys(revenue.revenueByPlan).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t('overview.revenueByPlan.title')}</CardTitle>
                <CardDescription>{t('overview.revenueByPlan.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {Object.entries(revenue.revenueByPlan)
                    .sort((a, b) => b[1] - a[1])
                    .map(([planName, planRevenue]) => {
                      const percentage = (planRevenue / revenue.mrr) * 100;
                      return (
                        <div key={planName} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-primary" />
                            <span className="font-medium">{planName}</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-sm text-muted-foreground">
                              {formatCurrency(planRevenue)}
                            </span>
                            <div className="w-32 bg-muted rounded-full h-2">
                              <div
                                className="bg-primary h-2 rounded-full"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium w-12 text-right">
                              {percentage.toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Revenue Tab */}
        <TabsContent value="revenue" className="space-y-6">
          {revenue && (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('revenue.metrics.mrr.title')}</CardTitle>
                    <CardDescription>{t('revenue.metrics.mrr.description')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{formatCurrency(revenue.mrr)}</div>
                    <div className="flex items-center gap-1 mt-2">
                      {getTrendIcon(revenue.revenueGrowth)}
                      <span className="text-sm text-muted-foreground">
                        {t('revenue.metrics.mrr.fromLastPeriod', {
                          percentage: formatPercentage(revenue.revenueGrowth),
                        })}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>{t('revenue.metrics.arr.title')}</CardTitle>
                    <CardDescription>{t('revenue.metrics.arr.description')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{formatCurrency(revenue.arr)}</div>
                    <p className="text-sm text-muted-foreground mt-2">
                      {t('revenue.metrics.arr.perMonth', {
                        amount: formatCurrency(revenue.arr / 12),
                      })}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>{t('revenue.metrics.arpu.title')}</CardTitle>
                    <CardDescription>{t('revenue.metrics.arpu.description')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {formatCurrency(revenue.averageRevenuePerUser)}
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">
                      {t('revenue.metrics.arpu.perUserPerMonth')}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>{t('revenue.breakdown.title')}</CardTitle>
                  <CardDescription>{t('revenue.breakdown.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('revenue.breakdown.table.plan')}</TableHead>
                          <TableHead className="text-right">
                            {t('revenue.breakdown.table.mrr')}
                          </TableHead>
                          <TableHead className="text-right">
                            {t('revenue.breakdown.table.percentage')}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(revenue.revenueByPlan).map(([planName, planRevenue]) => (
                          <TableRow key={planName}>
                            <TableCell className="font-medium">{planName}</TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(planRevenue)}
                            </TableCell>
                            <TableCell className="text-right">
                              {((planRevenue / revenue.mrr) * 100).toFixed(1)}%
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Growth Tab */}
        <TabsContent value="growth" className="space-y-6">
          {growth && (
            <>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('growth.metrics.newUsers.title')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{formatNumber(growth.newUsers)}</div>
                    <div className="flex items-center gap-1 mt-2">
                      {getTrendIcon(growth.growthRate)}
                      <span className="text-sm text-muted-foreground">
                        {formatPercentage(growth.growthRate)}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>{t('growth.metrics.netGrowth.title')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{formatNumber(growth.netGrowth)}</div>
                    <p className="text-sm text-muted-foreground mt-2">
                      {t('growth.metrics.netGrowth.description')}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>{t('growth.metrics.upgrades.title')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{formatNumber(growth.upgrades)}</div>
                    <p className="text-sm text-muted-foreground mt-2">
                      {t('growth.metrics.upgrades.description')}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>{t('growth.metrics.downgrades.title')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{formatNumber(growth.downgrades)}</div>
                    <p className="text-sm text-muted-foreground mt-2">
                      {t('growth.metrics.downgrades.description')}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>{t('growth.trial.title')}</CardTitle>
                  <CardDescription>{t('growth.trial.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                      <div>
                        <div className="text-sm font-medium">{t('growth.trial.newTrials')}</div>
                        <div className="text-2xl font-bold mt-1">
                          {formatNumber(growth.newTrials)}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm font-medium">{t('growth.trial.conversions')}</div>
                        <div className="text-2xl font-bold mt-1">
                          {formatNumber(growth.trialConversions)}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm font-medium">
                          {t('growth.trial.conversionRate')}
                        </div>
                        <div className="text-2xl font-bold mt-1">
                          {growth.trialConversionRate.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Churn Tab */}
        <TabsContent value="churn" className="space-y-6">
          {churn && (
            <>
              <div className="grid gap-4 md:grid-cols-4">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('churn.metrics.rate.title')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{churn.churnRate.toFixed(1)}%</div>
                    <p className="text-sm text-muted-foreground mt-2">
                      {t('churn.metrics.rate.users', { count: churn.churnedUsers })}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>{t('churn.metrics.retention.title')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{churn.retentionRate.toFixed(1)}%</div>
                    <p className="text-sm text-muted-foreground mt-2">
                      {t('churn.metrics.retention.description')}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>{t('churn.metrics.revenue.title')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{formatCurrency(churn.churnedRevenue)}</div>
                    <p className="text-sm text-muted-foreground mt-2">
                      {t('churn.metrics.revenue.description')}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>{t('churn.metrics.users.title')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{formatNumber(churn.churnedUsers)}</div>
                    <p className="text-sm text-muted-foreground mt-2">
                      {t('churn.metrics.users.description')}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {churn.monthlyChurnTrend.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('churn.trend.title')}</CardTitle>
                    <CardDescription>{t('churn.trend.description')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t('churn.trend.table.month')}</TableHead>
                            <TableHead className="text-right">
                              {t('churn.trend.table.churned')}
                            </TableHead>
                            <TableHead className="text-right">
                              {t('churn.trend.table.churnRate')}
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {churn.monthlyChurnTrend.map((trend) => (
                            <TableRow key={trend.month}>
                              <TableCell className="font-medium">{trend.month}</TableCell>
                              <TableCell className="text-right">{trend.count}</TableCell>
                              <TableCell className="text-right">{trend.rate.toFixed(1)}%</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {Object.keys(churn.churnReasons).length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('churn.reasons.title')}</CardTitle>
                    <CardDescription>{t('churn.reasons.description')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {Object.entries(churn.churnReasons)
                        .sort((a, b) => b[1] - a[1])
                        .map(([reason, count]) => (
                          <div key={reason} className="flex items-center justify-between">
                            <span className="text-sm">{reason}</span>
                            <Badge variant="secondary">{count}</Badge>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* Usage Tab */}
        <TabsContent value="usage" className="space-y-6">
          {usagePatterns.length > 0 && (
            <div className="grid gap-4">
              {usagePatterns.map((pattern) => (
                <Card key={pattern.metric}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="capitalize">{pattern.metric}</CardTitle>
                        <CardDescription>
                          {t('usage.metrics.average')}: {pattern.averageUsage.toFixed(1)} ·{' '}
                          {t('usage.metrics.peak')}: {pattern.peakUsage}
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            pattern.trend === 'increasing'
                              ? 'default'
                              : pattern.trend === 'decreasing'
                                ? 'destructive'
                                : 'secondary'
                          }
                        >
                          {t(`usage.metrics.trend.${pattern.trend}`)}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {formatPercentage(pattern.trendPercentage)}
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="grid grid-cols-5 gap-2">
                        {Object.entries(pattern.distribution).map(([range, count]) => (
                          <div key={range} className="text-center">
                            <div className="text-2xl font-bold">{count}</div>
                            <div className="text-xs text-muted-foreground">{range}</div>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                          {t('usage.metrics.utilization')}:
                        </span>
                        <div className="flex-1 bg-muted rounded-full h-2">
                          <div
                            className="bg-primary h-2 rounded-full"
                            style={{ width: `${Math.min(100, pattern.utilizationRate)}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium">
                          {pattern.utilizationRate.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Reliability Tab */}
        <TabsContent value="reliability" className="space-y-6">
          {loading && !reliability ? (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </CardContent>
            </Card>
          ) : reliability ? (
            <>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Work Items</CardTitle>
                    <Activity className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatNumber(reliability.reliability.overall.totalWorkItems)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Last {reliability.rangeDays} days
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Backlog</CardTitle>
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatNumber(reliability.reliability.overall.backlog)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Pending, processing, received, or running
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Failures</CardTitle>
                    <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatNumber(reliability.reliability.overall.failedWorkItems)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {reliability.reliability.overall.failureRate.toFixed(2)}% overall failure rate
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Retry Attempts</CardTitle>
                    <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatNumber(reliability.reliability.webhooks.retryAttempts)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatNumber(reliability.reliability.webhooks.successfulRetryAttempts)}{' '}
                      succeeded
                    </p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
                <Card className="min-w-0">
                  <CardHeader>
                    <CardTitle>Failure Trend</CardTitle>
                    <CardDescription>
                      Daily failed work items across queues and plugin jobs.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ReliabilityTrendChart data={reliability.reliability.trend} />
                  </CardContent>
                </Card>

                <Card className="min-w-0">
                  <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>Edge Access</CardTitle>
                      <CardDescription>Gateway and edge request failures.</CardDescription>
                    </div>
                    <Select
                      value={reliabilityFailureType}
                      onValueChange={setReliabilityFailureType}
                    >
                      <SelectTrigger className="w-full sm:w-[190px]">
                        <SelectValue placeholder="Failure type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All failure types</SelectItem>
                        {reliabilityFailureTypeOptions.map((failureType) => (
                          <SelectItem key={failureType} value={failureType}>
                            {failureType}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">Requests</div>
                        <div className="mt-1 text-xl font-semibold">
                          {formatNumber(reliability.reliability.edgeAccess.total)}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">Failed</div>
                        <div className="mt-1 text-xl font-semibold">
                          {formatNumber(reliability.reliability.edgeAccess.failed)}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">P95 Latency</div>
                        <div className="mt-1 text-xl font-semibold">
                          {formatNumber(reliability.reliability.edgeAccess.p95DurationMs)} ms
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Failure Rate</span>
                        <span className="font-medium">
                          {reliability.reliability.edgeAccess.failureRate.toFixed(2)}%
                        </span>
                      </div>
                      {reliability.reliability.edgeAccess.byFailureType.length > 0 ? (
                        reliability.reliability.edgeAccess.byFailureType.map((item) => (
                          <div
                            key={item.failureType ?? 'unknown'}
                            className="flex items-center justify-between gap-4 rounded-md border px-3 py-2 text-sm"
                          >
                            <span className="truncate text-muted-foreground">
                              {item.failureType ?? 'unknown'}
                            </span>
                            <Badge variant="secondary">{formatNumber(Number(item.count))}</Badge>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
                          No edge failure types recorded.
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <ReliabilityCard
                  title="Outbox"
                  description="Internal async event delivery"
                  rows={[
                    ['Total', formatNumber(reliability.reliability.outbox.total)],
                    ['Pending', formatNumber(reliability.reliability.outbox.pending)],
                    ['Processing', formatNumber(reliability.reliability.outbox.processing)],
                    ['Completed', formatNumber(reliability.reliability.outbox.completed)],
                    ['Failed', formatNumber(reliability.reliability.outbox.failed)],
                    ['Ready Pending', formatNumber(reliability.reliability.outbox.readyPending)],
                    ['Failure Rate', `${reliability.reliability.outbox.failureRate.toFixed(2)}%`],
                    [
                      'Oldest Failed',
                      formatDateTime(reliability.reliability.outbox.oldestFailedAt),
                    ],
                  ]}
                />
                <ReliabilityCard
                  title="Webhooks"
                  description="Inbound webhook receipt processing"
                  rows={[
                    ['Total', formatNumber(reliability.reliability.webhooks.total)],
                    ['Received', formatNumber(reliability.reliability.webhooks.received)],
                    ['Processing', formatNumber(reliability.reliability.webhooks.processing)],
                    ['Processed', formatNumber(reliability.reliability.webhooks.processed)],
                    ['Failed', formatNumber(reliability.reliability.webhooks.failed)],
                    ['Dead Letter', formatNumber(reliability.reliability.webhooks.deadLetter)],
                    ['Retryable', formatNumber(reliability.reliability.webhooks.retryable)],
                    ['Failure Rate', `${reliability.reliability.webhooks.failureRate.toFixed(2)}%`],
                  ]}
                />
                <ReliabilityCard
                  title="Plugin Jobs"
                  description="Plugin job execution status"
                  rows={[
                    ['Total', formatNumber(reliability.reliability.jobs.total)],
                    ['Running', formatNumber(reliability.reliability.jobs.running)],
                    ['Succeeded', formatNumber(reliability.reliability.jobs.succeeded)],
                    ['Dead Letter', formatNumber(reliability.reliability.jobs.deadLetter)],
                    ['Failure Rate', `${reliability.reliability.jobs.failureRate.toFixed(2)}%`],
                    [
                      'Oldest Dead Letter',
                      formatDateTime(reliability.reliability.jobs.oldestDeadLetteredAt),
                    ],
                  ]}
                />
              </div>
            </>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Reliability data unavailable</CardTitle>
                <CardDescription>
                  The reliability API did not return queue health metrics.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </TabsContent>

        {/* Cohorts Tab */}
        <TabsContent value="cohorts" className="space-y-6">
          {cohorts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t('cohorts.title')}</CardTitle>
                <CardDescription>{t('cohorts.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('cohorts.table.cohort')}</TableHead>
                        <TableHead className="text-right">{t('cohorts.table.size')}</TableHead>
                        <TableHead className="text-right">{t('cohorts.table.retained')}</TableHead>
                        <TableHead className="text-right">
                          {t('cohorts.table.retentionRate')}
                        </TableHead>
                        <TableHead className="text-right">{t('cohorts.table.revenue')}</TableHead>
                        <TableHead className="text-right">
                          {t('cohorts.table.avgLifetime')}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cohorts.map((cohort) => (
                        <TableRow key={cohort.cohort}>
                          <TableCell className="font-medium">{cohort.cohort}</TableCell>
                          <TableCell className="text-right">{cohort.size}</TableCell>
                          <TableCell className="text-right">{cohort.retained}</TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant={
                                cohort.retentionRate >= 80
                                  ? 'default'
                                  : cohort.retentionRate >= 60
                                    ? 'secondary'
                                    : 'destructive'
                              }
                            >
                              {cohort.retentionRate.toFixed(1)}%
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(cohort.revenue)}
                          </TableCell>
                          <TableCell className="text-right">
                            {cohort.averageLifetime.toFixed(0)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ReliabilityTrendChart({ data }: { data: ReliabilityMetrics['reliability']['trend'] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-md border text-sm text-muted-foreground">
        No reliability trend data.
      </div>
    );
  }

  return (
    <div className="h-[320px] min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="day" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="outboxFailed"
            name="Outbox"
            stroke="#2563eb"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="webhookFailed"
            name="Webhooks"
            stroke="#f97316"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="jobFailed"
            name="Plugin Jobs"
            stroke="#dc2626"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ReliabilityCard({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: Array<[string, string]>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium">{value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
