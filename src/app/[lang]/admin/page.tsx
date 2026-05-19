'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Shield, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useDashboard } from '@/hooks/use-dashboard';
import { useTranslations } from 'next-intl';
import { DashboardPageHeader, DashboardPageShell } from '@/components/dashboard/page-shell';

/**
 * Dashboard Home Page
 *
 * Displays:
 * - Key metrics (users, active roles, API usage)
 * - Recent activity
 * - System health indicators
 */
export default function DashboardPage() {
  const t = useTranslations('dashboard.admin');
  const { stats, recentUsers, systemStatus, statsLoading, usersLoading, statusLoading } =
    useDashboard();

  const formatUserStatus = (status: string) => {
    switch (status) {
      case 'pending':
        return t('recentUsers.status.pending');
      case 'active':
      default:
        return t('recentUsers.status.active');
    }
  };

  const formatServiceStatus = (status: string) => {
    switch (status) {
      case 'degraded':
        return t('systemStatus.status.degraded');
      case 'down':
        return t('systemStatus.status.down');
      case 'operational':
      default:
        return t('systemStatus.status.operational');
    }
  };

  const formatLatency = (latency: string) => {
    if (latency === 'background') return t('systemStatus.latencyBackground');
    if (latency === 'N/A') return t('systemStatus.latencyUnavailable');
    return t('systemStatus.latencyAvg', { latency });
  };

  return (
    <DashboardPageShell>
      {/* Page Header */}
      <DashboardPageHeader title={t('title')} description={t('description')} />

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Total Users */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('stats.totalUsers')}</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <>
                <div className="h-8 w-20 bg-muted animate-pulse rounded mb-2" />
                <div className="h-4 w-32 bg-muted animate-pulse rounded" />
              </>
            ) : (
              <>
                <div className="text-2xl font-bold">{stats?.users.total.toLocaleString() || 0}</div>
                <p className="text-xs text-muted-foreground">
                  <span className="text-success">{stats?.users.growth}</span>{' '}
                  {t('stats.fromLastMonth')}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Active Roles */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('stats.activeRoles')}</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <>
                <div className="h-8 w-20 bg-muted animate-pulse rounded mb-2" />
                <div className="h-4 w-32 bg-muted animate-pulse rounded" />
              </>
            ) : (
              <>
                <div className="text-2xl font-bold">{stats?.roles.active || 0}</div>
                <p className="text-xs text-muted-foreground">
                  {t('stats.activeAssignments', { count: stats?.roles.active || 0 })}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* API Usage */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('stats.apiRequests')}</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <>
                <div className="h-8 w-20 bg-muted animate-pulse rounded mb-2" />
                <div className="h-4 w-32 bg-muted animate-pulse rounded" />
              </>
            ) : (
              <>
                <div className="text-2xl font-bold">{stats?.apiRequests.total}</div>
                <p className="text-xs text-muted-foreground">
                  <span className="text-success">{stats?.apiRequests.growth}</span>{' '}
                  {t('stats.fromYesterday')}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>{t('recentUsers.title')}</CardTitle>
          <CardDescription>{t('recentUsers.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {usersLoading ? (
            <div className="space-y-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
                    <div className="space-y-2">
                      <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                      <div className="h-3 w-32 bg-muted animate-pulse rounded" />
                    </div>
                  </div>
                  <div className="h-6 w-16 bg-muted animate-pulse rounded" />
                </div>
              ))}
            </div>
          ) : recentUsers.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              {t('recentUsers.noData')}
            </div>
          ) : (
            <div className="space-y-4">
              {recentUsers.slice(0, 4).map((user) => (
                <div key={user.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold">
                      {user.name
                        .split(' ')
                        .map((n) => n[0])
                        .join('')}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{user.name}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant={user.status === 'active' ? 'default' : 'secondary'}>
                      {formatUserStatus(user.status)}
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-1">{user.time}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* System Status */}
      <Card>
        <CardHeader>
          <CardTitle>{t('systemStatus.title')}</CardTitle>
          <CardDescription>{t('systemStatus.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {statusLoading ? (
            <div className="grid gap-4 md:grid-cols-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="h-2 w-2 rounded-full bg-muted animate-pulse" />
                    <div className="space-y-2">
                      <div className="h-4 w-20 bg-muted animate-pulse rounded" />
                      <div className="h-3 w-16 bg-muted animate-pulse rounded" />
                    </div>
                  </div>
                  <div className="h-6 w-20 bg-muted animate-pulse rounded" />
                </div>
              ))}
            </div>
          ) : systemStatus.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              {t('systemStatus.noData')}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {systemStatus.map((service, index) => {
                const statusColor =
                  service.statusCode === 'ok'
                    ? 'bg-success-500'
                    : service.statusCode === 'warning'
                      ? 'bg-warning-500'
                      : 'bg-destructive-500';
                const statusTextColor =
                  service.statusCode === 'ok'
                    ? 'text-success border-green-600'
                    : service.statusCode === 'warning'
                      ? 'text-warning border-yellow-600'
                      : 'text-destructive border-red-600';

                return (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-2 w-2 rounded-full ${statusColor}`} />
                      <div>
                        <p className="text-sm font-medium">{service.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatLatency(service.latency)}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className={statusTextColor}>
                      {formatServiceStatus(service.status)}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </DashboardPageShell>
  );
}
