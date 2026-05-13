'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useUsage, useUsageWarnings, type UsageMetric } from '@/hooks/use-usage';
import { UsageCard, UsageCardCompact } from './usage-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/_core/utils';

interface UsageOverviewProps {
  userId: string;
  variant?: 'full' | 'compact';
  showUpgradeButtons?: boolean;
  onUpgrade?: () => void;
  className?: string;
}

export function UsageOverview({
  userId,
  variant = 'full',
  showUpgradeButtons = false,
  onUpgrade,
  className,
}: UsageOverviewProps) {
  const t = useTranslations('components.usage.usageOverview');
  const { usage, loading, error } = useUsage(userId);

  if (loading) {
    return (
      <div className={cn('grid gap-4 md:grid-cols-2 lg:grid-cols-4', className)}>
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-40 rounded-lg border bg-muted/50 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error || !usage) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertTitle>{t('errorLoading')}</AlertTitle>
        <AlertDescription>{error?.message || t('failedToLoad')}</AlertDescription>
      </Alert>
    );
  }

  const metrics: UsageMetric[] = ['users', 'storage', 'apiCalls', 'plugins'];

  if (variant === 'compact') {
    return (
      <div className={cn('grid gap-4 md:grid-cols-2 lg:grid-cols-4', className)}>
        {metrics.map((metric) => (
          <UsageCardCompact key={metric} metric={metric} data={usage[metric]} />
        ))}
      </div>
    );
  }

  return (
    <div className={cn('grid gap-4 md:grid-cols-2 lg:grid-cols-4', className)}>
      {metrics.map((metric) => (
        <UsageCard
          key={metric}
          metric={metric}
          data={usage[metric]}
          showUpgradeButton={showUpgradeButtons}
          onUpgrade={onUpgrade}
        />
      ))}
    </div>
  );
}

/**
 * Usage warnings banner
 * Shows alerts when usage is approaching or exceeding limits
 */
interface UsageWarningsBannerProps {
  userId: string;
  onUpgrade?: () => void;
  className?: string;
}

export function UsageWarningsBanner({ userId, onUpgrade, className }: UsageWarningsBannerProps) {
  const { warnings, hasWarnings, hasCritical } = useUsageWarnings(userId);

  if (!hasWarnings) {
    return null;
  }

  // Show the most severe warning
  const mostSevere = warnings.reduce((prev, current) => {
    const severityOrder = { exceeded: 3, critical: 2, warning: 1 };
    return severityOrder[current.status] > severityOrder[prev.status] ? current : prev;
  });

  const variant = mostSevere.status === 'exceeded' ? 'destructive' : 'default';

  const icon =
    mostSevere.status === 'exceeded' ? (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
    ) : (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    );

  return (
    <Alert variant={variant} className={className}>
      <div className="flex items-start gap-3">
        {icon}
        <div className="flex-1 space-y-2">
          <AlertTitle>{hasCritical ? 'Usage Limit Alert' : 'Usage Warning'}</AlertTitle>
          <AlertDescription>
            <div className="space-y-1">
              {warnings.slice(0, 3).map((warning, index) => (
                <div key={index} className="text-sm">
                  • {warning.message}
                </div>
              ))}
              {warnings.length > 3 && (
                <div className="text-sm text-muted-foreground">
                  And {warnings.length - 3} more...
                </div>
              )}
            </div>
          </AlertDescription>
          {onUpgrade && (
            <button
              onClick={onUpgrade}
              className={cn(
                'mt-3 inline-flex items-center rounded-md px-3 py-2 text-sm font-semibold shadow-sm',
                variant === 'destructive'
                  ? 'bg-card text-destructive hover:bg-destructive-50'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
              )}
            >
              Upgrade Plan
            </button>
          )}
        </div>
      </div>
    </Alert>
  );
}

/**
 * Individual usage warning item
 */
interface UsageWarningItemProps {
  metric: UsageMetric;
  current: number;
  limit: number;
  percentage: number;
  status: 'warning' | 'critical' | 'exceeded';
  onUpgrade?: () => void;
}

export function UsageWarningItem({
  metric,
  current,
  limit,
  percentage,
  status,
  onUpgrade,
}: UsageWarningItemProps) {
  const metricNames = {
    users: 'Users',
    storage: 'Storage',
    apiCalls: 'API Calls',
    plugins: 'Plugins',
  };

  const statusColors = {
    warning: 'bg-warning-50 text-warning-foreground border-warning',
    critical: 'bg-warning-50 text-warning-foreground border-warning',
    exceeded: 'bg-destructive-50 text-destructive-foreground border-destructive',
  };

  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-lg border p-3',
        statusColors[status]
      )}
    >
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{metricNames[metric]}</span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium',
              status === 'exceeded'
                ? 'bg-destructive-100 text-destructive'
                : status === 'critical'
                  ? 'bg-warning-100 text-warning'
                  : 'bg-warning-100 text-warning'
            )}
          >
            {Math.round(percentage)}%
          </span>
        </div>
        <div className="mt-1 text-xs opacity-75">
          {current} / {limit} used
        </div>
      </div>
      {onUpgrade && status !== 'warning' && (
        <button onClick={onUpgrade} className="ml-3 text-xs font-medium hover:underline">
          Upgrade
        </button>
      )}
    </div>
  );
}
