'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/_core/utils';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  XCircle,
  Bell,
  TrendingUp,
  ArrowUpRight,
  X,
} from 'lucide-react';
import type { UsageMetric } from '@/hooks/use-usage';

/**
 * Usage Alerts Components
 *
 * Alert and notification components for usage limits
 * Features:
 * - Multiple severity levels (info, warning, critical, exceeded)
 * - Dismissible alerts
 * - Sticky banners
 * - Alert center with all notifications
 * - Customizable actions
 */

export interface UsageAlert {
  id: string;
  metric: UsageMetric;
  severity: 'info' | 'warning' | 'critical' | 'exceeded';
  title: string;
  message: string;
  percentage: number;
  used: number;
  allowed?: number;
  isUnlimited?: boolean;
  timestamp: Date;
  dismissed?: boolean;
}

/**
 * Single Usage Alert
 */
export function UsageAlertItem({
  alert,
  showActions = true,
  onDismiss,
  onUpgrade,
  className,
}: {
  alert: UsageAlert;
  showActions?: boolean;
  onDismiss?: (id: string) => void;
  onUpgrade?: (metric: UsageMetric) => void;
  className?: string;
}) {
  const t = useTranslations('components.usage.usageAlerts');

  const getAlertVariant = () => {
    switch (alert.severity) {
      case 'exceeded':
      case 'critical':
        return 'destructive';
      default:
        return 'default';
    }
  };

  const getIcon = () => {
    switch (alert.severity) {
      case 'exceeded':
        return <XCircle className="h-4 w-4" />;
      case 'critical':
        return <AlertTriangle className="h-4 w-4" />;
      case 'warning':
        return <AlertCircle className="h-4 w-4" />;
      case 'info':
      default:
        return <Info className="h-4 w-4" />;
    }
  };

  const getBorderColor = () => {
    switch (alert.severity) {
      case 'exceeded':
        return 'border-destructive';
      case 'critical':
        return 'border-warning';
      case 'warning':
        return 'border-warning';
      case 'info':
      default:
        return 'border-primary';
    }
  };

  const getBackgroundColor = () => {
    switch (alert.severity) {
      case 'exceeded':
        return 'bg-destructive-50 dark:bg-destructive-50/20';
      case 'critical':
        return 'bg-warning-50 dark:bg-warning-50/20';
      case 'warning':
        return 'bg-warning-50 dark:bg-warning-50/20';
      case 'info':
      default:
        return 'bg-primary-50 dark:bg-primary-50/20';
    }
  };

  return (
    <Alert
      variant={getAlertVariant()}
      className={cn('border-l-4', getBorderColor(), getBackgroundColor(), className)}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          {getIcon()}
          <div className="flex-1 space-y-1">
            <AlertTitle className="flex items-center gap-2">
              {alert.title}
              <Badge variant="outline" className="text-xs">
                {alert.percentage.toFixed(1)}%
              </Badge>
            </AlertTitle>
            <AlertDescription>{alert.message}</AlertDescription>

            {!alert.isUnlimited && (
              <div className="mt-3 space-y-2">
                <Progress value={Math.min(100, alert.percentage)} className="h-2" />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {alert.used.toLocaleString()} / {alert.allowed?.toLocaleString() || 'N/A'}
                  </span>
                  <span>{t(`metrics.${alert.metric}`)}</span>
                </div>
              </div>
            )}

            {showActions && (alert.severity === 'critical' || alert.severity === 'exceeded') && (
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" variant="default" onClick={() => onUpgrade?.(alert.metric)}>
                  <ArrowUpRight className="h-3 w-3 mr-1" />
                  {t('upgradePlan')}
                </Button>
              </div>
            )}
          </div>
        </div>

        {onDismiss && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => onDismiss(alert.id)}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </Alert>
  );
}

/**
 * Usage Alerts Banner (Sticky)
 */
export function UsageAlertsBanner({
  alerts,
  maxVisible = 3,
  onDismiss,
  onUpgrade,
  onViewAll,
  className,
}: {
  alerts: UsageAlert[];
  maxVisible?: number;
  onDismiss?: (id: string) => void;
  onUpgrade?: (metric: UsageMetric) => void;
  onViewAll?: () => void;
  className?: string;
}) {
  const t = useTranslations('components.usage.usageAlerts');

  if (alerts.length === 0) return null;

  const visibleAlerts = alerts.slice(0, maxVisible);
  const hasMore = alerts.length > maxVisible;

  return (
    <div className={cn('space-y-3', className)}>
      {visibleAlerts.map((alert) => (
        <UsageAlertItem key={alert.id} alert={alert} onDismiss={onDismiss} onUpgrade={onUpgrade} />
      ))}

      {hasMore && (
        <Alert className="border-dashed cursor-pointer" onClick={onViewAll}>
          <Bell className="h-4 w-4" />
          <AlertTitle>{t('moreAlerts')}</AlertTitle>
          <AlertDescription>
            {t(
              alerts.length - maxVisible === 1
                ? 'moreAlertsDescription'
                : 'moreAlertsDescriptionPlural',
              {
                count: alerts.length - maxVisible,
              }
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/**
 * Usage Alert Center
 */
export function UsageAlertCenter({
  alerts,
  onDismiss,
  onDismissAll,
  onUpgrade,
  className,
}: {
  alerts: UsageAlert[];
  onDismiss?: (id: string) => void;
  onDismissAll?: () => void;
  onUpgrade?: (metric: UsageMetric) => void;
  className?: string;
}) {
  const t = useTranslations('components.usage.usageAlerts');

  if (alerts.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Bell className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">{t('noAlerts')}</h3>
          <p className="text-sm text-muted-foreground text-center mt-2">
            {t('noAlertsDescription')}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Group alerts by severity
  const groupedAlerts = {
    exceeded: alerts.filter((a) => a.severity === 'exceeded'),
    critical: alerts.filter((a) => a.severity === 'critical'),
    warning: alerts.filter((a) => a.severity === 'warning'),
    info: alerts.filter((a) => a.severity === 'info'),
  };

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              {t('usageAlerts')}
            </CardTitle>
            <CardDescription>
              {t(alerts.length === 1 ? 'activeAlerts' : 'activeAlertsPlural', {
                count: alerts.length,
              })}
            </CardDescription>
          </div>
          {onDismissAll && alerts.length > 0 && (
            <Button variant="ghost" size="sm" onClick={onDismissAll}>
              {t('dismissAll')}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {groupedAlerts.exceeded.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-destructive flex items-center gap-2">
              <XCircle className="h-4 w-4" />
              {t('limitExceeded', { count: groupedAlerts.exceeded.length })}
            </h4>
            <div className="space-y-3">
              {groupedAlerts.exceeded.map((alert) => (
                <UsageAlertItem
                  key={alert.id}
                  alert={alert}
                  onDismiss={onDismiss}
                  onUpgrade={onUpgrade}
                />
              ))}
            </div>
          </div>
        )}

        {groupedAlerts.critical.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-warning flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {t('critical', { count: groupedAlerts.critical.length })}
            </h4>
            <div className="space-y-3">
              {groupedAlerts.critical.map((alert) => (
                <UsageAlertItem
                  key={alert.id}
                  alert={alert}
                  onDismiss={onDismiss}
                  onUpgrade={onUpgrade}
                />
              ))}
            </div>
          </div>
        )}

        {groupedAlerts.warning.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-warning flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {t('warning', { count: groupedAlerts.warning.length })}
            </h4>
            <div className="space-y-3">
              {groupedAlerts.warning.map((alert) => (
                <UsageAlertItem
                  key={alert.id}
                  alert={alert}
                  onDismiss={onDismiss}
                  onUpgrade={onUpgrade}
                />
              ))}
            </div>
          </div>
        )}

        {groupedAlerts.info.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-primary flex items-center gap-2">
              <Info className="h-4 w-4" />
              {t('information', { count: groupedAlerts.info.length })}
            </h4>
            <div className="space-y-3">
              {groupedAlerts.info.map((alert) => (
                <UsageAlertItem
                  key={alert.id}
                  alert={alert}
                  onDismiss={onDismiss}
                  onUpgrade={onUpgrade}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Compact Alert Summary Card
 */
export function UsageAlertSummary({
  alerts,
  onClick,
  className,
}: {
  alerts: UsageAlert[];
  onClick?: () => void;
  className?: string;
}) {
  const t = useTranslations('components.usage.usageAlerts');

  const criticalCount = alerts.filter(
    (a) => a.severity === 'exceeded' || a.severity === 'critical'
  ).length;
  const warningCount = alerts.filter((a) => a.severity === 'warning').length;

  if (alerts.length === 0) return null;

  return (
    <Card
      className={cn('cursor-pointer hover:bg-muted/50 transition-colors', className)}
      onClick={onClick}
    >
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Bell className="h-5 w-5" />
              {criticalCount > 0 && (
                <div className="absolute -top-1 -right-1 h-3 w-3 bg-destructive rounded-full animate-pulse" />
              )}
            </div>
            <div>
              <div className="text-sm font-medium">{t('usageAlerts')}</div>
              <div className="text-xs text-muted-foreground">
                {criticalCount > 0 && (
                  <span className="text-destructive">
                    {t('critical', { count: criticalCount })}
                  </span>
                )}
                {criticalCount > 0 && warningCount > 0 && <span>, </span>}
                {warningCount > 0 && (
                  <span className="text-warning">{t('warning', { count: warningCount })}</span>
                )}
              </div>
            </div>
          </div>
          <Badge variant={criticalCount > 0 ? 'destructive' : 'secondary'}>{alerts.length}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Inline Usage Warning
 */
export function InlineUsageWarning({
  metric,
  percentage,
  used,
  allowed,
  status,
  compact = false,
  showUpgrade = true,
  onUpgrade,
  className,
}: {
  metric: UsageMetric;
  percentage: number;
  used: number;
  allowed?: number;
  status: 'ok' | 'warning' | 'critical' | 'exceeded';
  compact?: boolean;
  showUpgrade?: boolean;
  onUpgrade?: () => void;
  className?: string;
}) {
  const t = useTranslations('components.usage.usageAlerts');

  if (status === 'ok') return null;

  const getMessage = () => {
    const metricLabel = t(`metrics.${metric}`).toLowerCase();
    if (status === 'exceeded') {
      return t('exceeded', { metric: metricLabel });
    }
    if (status === 'critical') {
      return t('approaching', { metric: metricLabel });
    }
    return t('increasing', { metric: metricLabel });
  };

  if (compact) {
    return (
      <div className={cn('flex items-center gap-2 text-sm', className)}>
        <AlertTriangle
          className={cn(
            'h-4 w-4',
            status === 'exceeded'
              ? 'text-destructive'
              : status === 'critical'
                ? 'text-warning'
                : 'text-warning'
          )}
        />
        <span className="text-muted-foreground">{percentage.toFixed(1)}% used</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border p-3 space-y-2',
        status === 'exceeded'
          ? 'border-destructive bg-destructive-50 dark:bg-destructive-50/20'
          : status === 'critical'
            ? 'border-warning bg-warning-50 dark:bg-warning-50/20'
            : 'border-warning bg-warning-50 dark:bg-warning-50/20',
        className
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          className={cn(
            'h-4 w-4 mt-0.5',
            status === 'exceeded'
              ? 'text-destructive'
              : status === 'critical'
                ? 'text-warning'
                : 'text-warning'
          )}
        />
        <div className="flex-1 space-y-1">
          <p className="text-sm font-medium">{getMessage()}</p>
          <p className="text-xs text-muted-foreground">
            {used.toLocaleString()} of {allowed?.toLocaleString() || 'N/A'} used (
            {percentage.toFixed(1)}%)
          </p>
        </div>
      </div>
      {showUpgrade && (status === 'critical' || status === 'exceeded') && (
        <Button size="sm" variant="default" className="w-full" onClick={onUpgrade}>
          <ArrowUpRight className="h-3 w-3 mr-1" />
          {t('upgradePlan')}
        </Button>
      )}
    </div>
  );
}

/**
 * Predictive Usage Alert
 */
export function PredictiveUsageAlert({
  metric,
  currentUsage: _currentUsage,
  trend,
  daysUntilLimit,
  className,
}: {
  metric: UsageMetric;
  currentUsage: number;
  trend: number; // percentage change
  daysUntilLimit?: number;
  className?: string;
}) {
  const t = useTranslations('components.usage.usageAlerts');

  if (!daysUntilLimit || daysUntilLimit > 30) return null;

  const isUrgent = daysUntilLimit <= 7;

  return (
    <Alert
      className={cn('border-l-4', isUrgent ? 'border-destructive' : 'border-warning', className)}
    >
      <TrendingUp className={cn('h-4 w-4', isUrgent ? 'text-destructive' : 'text-warning')} />
      <AlertTitle className={isUrgent ? 'text-destructive-foreground' : 'text-warning-foreground'}>
        {t('projectedLimit')}
      </AlertTitle>
      <AlertDescription
        className={isUrgent ? 'text-destructive-foreground' : 'text-warning-foreground'}
      >
        {t(isUrgent ? 'projectedLimitDescriptionUrgent' : 'projectedLimitDescription', {
          trend: `${trend > 0 ? '+' : ''}${trend.toFixed(1)}`,
          metric: t(`metrics.${metric}`).toLowerCase(),
          days: daysUntilLimit,
        })}
      </AlertDescription>
    </Alert>
  );
}
