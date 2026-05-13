'use client';

import * as React from 'react';
import useSWR from 'swr';
import { useParams } from 'next/navigation';
import { Activity, BarChart3, Filter, RefreshCw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { API_KEYS } from '@/lib/swr/keys';
import { apiFetch } from '@/lib/shared/auth-client';

interface AdminUsageData {
  rangeDays: number;
  startAt: string;
  endAt: string;
  filters: {
    metric: string | null;
    userId: string | null;
    limit: number;
  };
  totalEvents: number;
  topMetrics: Array<{ key: string; total: number }>;
  topUsers: Array<{
    userId: string;
    userName: string | null;
    userEmail: string | null;
    total: number;
  }>;
  recentEvents: Array<{
    id: string;
    userId: string;
    userName: string | null;
    userEmail: string | null;
    key: string;
    value: number;
    unit: string;
    recordedAt: string;
  }>;
}

interface AdminUsageResponse {
  success?: boolean;
  data?: AdminUsageData;
  error?: unknown;
}

async function fetchAdminUsage(url: string): Promise<AdminUsageData> {
  const response = await apiFetch(url);
  const body = (await response.json().catch(() => null)) as AdminUsageResponse | null;

  if (!response.ok || body?.success !== true || !body.data) {
    throw new Error('Failed to load admin usage data');
  }

  return body.data;
}

export default function UsageDashboardPageClient() {
  const params = useParams();
  const lang = params.lang === 'zh' ? 'zh' : 'en';
  const [days, setDays] = React.useState('30');
  const [limit, setLimit] = React.useState('10');
  const [metricDraft, setMetricDraft] = React.useState('');
  const [userDraft, setUserDraft] = React.useState('');
  const [metricFilter, setMetricFilter] = React.useState('');
  const [userFilter, setUserFilter] = React.useState('');

  const usageUrl = React.useMemo(() => {
    const searchParams = new URLSearchParams({
      days,
      limit,
    });

    if (metricFilter.trim()) {
      searchParams.set('metric', metricFilter.trim());
    }

    if (userFilter.trim()) {
      searchParams.set('userId', userFilter.trim());
    }

    return `${API_KEYS.ENTITLEMENTS.USAGE}?${searchParams.toString()}`;
  }, [days, limit, metricFilter, userFilter]);

  const { data, error, isLoading, mutate, isValidating } = useSWR(usageUrl, fetchAdminUsage, {
    revalidateOnFocus: false,
  });

  const numberFormatter = React.useMemo(
    () => new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 0 }),
    [lang]
  );

  const dateFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [lang]
  );

  const formatNumber = React.useCallback(
    (value: number) => numberFormatter.format(Number.isFinite(value) ? value : 0),
    [numberFormatter]
  );

  const maxMetricTotal = React.useMemo(
    () => Math.max(1, ...(data?.topMetrics.map((metric) => metric.total) ?? [])),
    [data?.topMetrics]
  );
  const maxUserTotal = React.useMemo(
    () => Math.max(1, ...(data?.topUsers.map((user) => user.total) ?? [])),
    [data?.topUsers]
  );

  function applyFilters() {
    setMetricFilter(metricDraft.trim());
    setUserFilter(userDraft.trim());
  }

  function clearFilters() {
    setMetricDraft('');
    setUserDraft('');
    setMetricFilter('');
    setUserFilter('');
    setDays('30');
    setLimit('10');
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
          <p className="text-sm text-muted-foreground">
            Platform quota events and top consumers from the last {data?.rangeDays ?? 30} days.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void mutate()} disabled={isValidating}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
          <CardDescription>Limit the usage window by time, metric key, or user id.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-[140px_140px_minmax(180px,1fr)_minmax(180px,1fr)_auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="usage-days">Window</Label>
              <Select value={days} onValueChange={setDays}>
                <SelectTrigger id="usage-days">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                  <SelectItem value="365">365 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="usage-limit">Rows</Label>
              <Select value={limit} onValueChange={setLimit}>
                <SelectTrigger id="usage-limit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="usage-metric">Metric</Label>
              <Input
                id="usage-metric"
                value={metricDraft}
                onChange={(event) => setMetricDraft(event.target.value)}
                placeholder="platform.apiCalls"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="usage-user">User ID</Label>
              <Input
                id="usage-user"
                value={userDraft}
                onChange={(event) => setUserDraft(event.target.value)}
                placeholder="user id"
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={applyFilters}>
                Apply
              </Button>
              <Button type="button" variant="outline" onClick={clearFilters}>
                Clear
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle>Usage data unavailable</CardTitle>
            <CardDescription>
              The admin usage API did not return a valid platform usage summary.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          label="Events"
          value={isLoading ? null : formatNumber(data?.totalEvents ?? 0)}
          detail={`Window: ${data?.rangeDays ?? 30} days`}
        />
        <MetricCard
          icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
          label="Tracked metrics"
          value={isLoading ? null : formatNumber(data?.topMetrics.length ?? 0)}
          detail="Grouped by plugin and metric"
        />
        <MetricCard
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
          label="Active users"
          value={isLoading ? null : formatNumber(data?.topUsers.length ?? 0)}
          detail="Ranked by usage value"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Top Metrics</CardTitle>
            <CardDescription>
              {data
                ? `${dateFormatter.format(new Date(data.startAt))} - ${dateFormatter.format(
                    new Date(data.endAt)
                  )}`
                : 'Loading current usage window'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <LoadingRows count={5} />
            ) : data?.topMetrics.length ? (
              <div className="space-y-4">
                {data.topMetrics.map((metric) => (
                  <div key={metric.key} className="space-y-2">
                    <div className="flex items-center justify-between gap-4">
                      <span className="min-w-0 truncate font-mono text-sm" title={metric.key}>
                        {metric.key}
                      </span>
                      <span className="text-sm font-medium">{formatNumber(metric.total)}</span>
                    </div>
                    <Progress
                      aria-label={`Usage for ${metric.key}`}
                      value={(metric.total / maxMetricTotal) * 100}
                      className="h-2"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="No usage events recorded in this window." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Users</CardTitle>
            <CardDescription>Users with the highest recorded quota usage.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <LoadingRows count={5} />
            ) : data?.topUsers.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead className="text-right">Usage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.topUsers.map((user) => (
                    <TableRow key={user.userId}>
                      <TableCell>
                        <div className="max-w-[260px] space-y-1">
                          <div className="truncate font-medium">
                            {user.userName || user.userEmail || user.userId}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {user.userEmail || user.userId}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="space-y-1">
                          <div className="font-medium">{formatNumber(user.total)}</div>
                          <Progress
                            aria-label={`Usage for ${
                              user.userName || user.userEmail || user.userId
                            }`}
                            value={(user.total / maxUserTotal) * 100}
                            className="h-1.5"
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState message="No user usage records in this window." />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Events</CardTitle>
          <CardDescription>
            {data?.filters.metric || data?.filters.userId
              ? 'Latest usage records matching the active filters.'
              : 'Latest usage records in the active window.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LoadingRows count={5} />
          ) : data?.recentEvents.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentEvents.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="font-mono text-sm">{event.key}</TableCell>
                    <TableCell>
                      <div className="max-w-[320px] space-y-1">
                        <div className="truncate font-medium">
                          {event.userName || event.userEmail || event.userId}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {event.userEmail || event.userId}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatNumber(event.value)} {event.unit}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {dateFormatter.format(new Date(event.recordedAt))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState message="No usage events match the current filters." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
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

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}
