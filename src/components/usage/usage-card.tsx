'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/_core/utils';
import {
  type UsageMetric,
  type UsageMetricData,
  formatMetricValue,
  getStatusColor,
  getProgressBarColor,
} from '@/hooks/use-usage';

interface UsageCardProps {
  metric: UsageMetric;
  data: UsageMetricData;
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  showPercentage?: boolean;
  showUpgradeButton?: boolean;
  onUpgrade?: () => void;
  className?: string;
}

const metricIcons: Record<UsageMetric, React.ReactNode> = {
  users: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
      />
    </svg>
  ),
  storage: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
      />
    </svg>
  ),
  apiCalls: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 10V3L4 14h7v7l9-11h-7z"
      />
    </svg>
  ),
  plugins: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z"
      />
    </svg>
  ),
};

export function UsageCard({
  metric,
  data,
  title,
  description,
  icon,
  showPercentage = true,
  showUpgradeButton = false,
  onUpgrade,
  className,
}: UsageCardProps) {
  const t = useTranslations('components.usage.usageCard');

  const displayTitle = title || t(metric);
  const displayDescription = description || t(`descriptions.${metric}`);
  const displayIcon = icon || metricIcons[metric];

  const status = data.isUnlimited
    ? 'ok'
    : !data.allowed
      ? 'exceeded'
      : data.percentage >= 95
        ? 'critical'
        : data.percentage >= 80
          ? 'warning'
          : 'ok';

  const statusColor = getStatusColor(status);
  const _progressColor = getProgressBarColor(status);

  return (
    <Card className={cn('', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn('rounded-lg p-2', statusColor)}>{displayIcon}</div>
            <div>
              <CardTitle className="text-base">{displayTitle}</CardTitle>
              <CardDescription className="text-xs">{displayDescription}</CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Usage numbers */}
        <div className="flex items-baseline justify-between">
          <div className="text-2xl font-bold">{formatMetricValue(metric, data.current)}</div>
          {!data.isUnlimited && (
            <div className="text-sm text-muted-foreground">
              {t('of')} {formatMetricValue(metric, data.limit)}
            </div>
          )}
        </div>

        {/* Progress bar */}
        {!data.isUnlimited && (
          <div className="space-y-1">
            <Progress value={Math.min(100, data.percentage)} className="h-2" />
            {showPercentage && (
              <div className="flex items-center justify-between text-xs">
                <span className={cn('font-medium', statusColor)}>
                  {t('used', { percentage: Math.round(data.percentage) })}
                </span>
                {status === 'exceeded' && (
                  <span className="text-destructive font-medium">{t('overLimit')}</span>
                )}
                {status === 'critical' && (
                  <span className="text-warning font-medium">{t('criticallyHigh')}</span>
                )}
                {status === 'warning' && (
                  <span className="text-warning font-medium">{t('approachingLimit')}</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Unlimited badge */}
        {data.isUnlimited && (
          <div className="inline-flex items-center gap-1 rounded-full bg-success-50 px-2 py-1 text-xs font-medium text-success">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            {t('unlimited')}
          </div>
        )}

        {/* Upgrade button */}
        {showUpgradeButton && !data.isUnlimited && status !== 'ok' && (
          <button
            onClick={onUpgrade}
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {t('upgradePlan')}
          </button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Compact usage card for dashboard overview
 */
export function UsageCardCompact({
  metric,
  data,
  className,
}: {
  metric: UsageMetric;
  data: UsageMetricData;
  className?: string;
}) {
  const t = useTranslations('components.usage.usageCard');

  const title = t(metric);
  const icon = metricIcons[metric];

  const status = data.isUnlimited
    ? 'ok'
    : !data.allowed
      ? 'exceeded'
      : data.percentage >= 95
        ? 'critical'
        : data.percentage >= 80
          ? 'warning'
          : 'ok';

  const statusColor = getStatusColor(status);

  return (
    <div className={cn('flex items-center gap-3 rounded-lg border p-4', className)}>
      <div className={cn('rounded-lg p-2', statusColor)}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-muted-foreground">{title}</div>
        <div className="flex items-baseline gap-2">
          <div className="text-xl font-bold">{formatMetricValue(metric, data.current)}</div>
          {!data.isUnlimited && (
            <div className="text-sm text-muted-foreground">
              {t('of')} {formatMetricValue(metric, data.limit)}
            </div>
          )}
        </div>
        {!data.isUnlimited && (
          <Progress value={Math.min(100, data.percentage)} className="mt-2 h-1.5" />
        )}
      </div>
    </div>
  );
}
