'use client';

import { useState, useEffect, useCallback } from 'react';
import { useEntitlement } from './use-entitlement';
import { apiFetch } from '@/lib/shared/auth-client';

/**
 * Usage Hook
 *
 * React hook for tracking and displaying user resource usage
 *
 * Usage:
 * ```tsx
 * const { usage, percentages, isApproachingLimit, loading } = useUsage(userId);
 *
 * console.log(`Using ${usage.users.current} of ${usage.users.limit} users`);
 * console.log(`Storage: ${percentages.storage}%`);
 * ```
 */

export type UsageMetric = 'users' | 'storage' | 'apiCalls' | 'plugins';

export interface UsageMetricData {
  current: number;
  limit: number;
  percentage: number;
  allowed: boolean;
  isUnlimited: boolean;
}

export interface UsageTrend {
  date: string;
  value: number;
}

export interface UsageStats {
  current: number;
  average: number;
  peak: number;
  low: number;
  trend: 'up' | 'down' | 'stable';
}

export interface UsageData {
  users: UsageMetricData;
  storage: UsageMetricData;
  apiCalls: UsageMetricData;
  plugins: UsageMetricData;
}

interface UseUsageResult {
  usage: UsageData | null;
  trends: Record<UsageMetric, UsageTrend[]> | null;
  stats: Record<UsageMetric, UsageStats> | null;
  percentages: Record<UsageMetric, number>;
  isApproachingLimit: (metric: UsageMetric, threshold?: number) => boolean;
  isOverLimit: (metric: UsageMetric) => boolean;
  getMetricStatus: (metric: UsageMetric) => 'ok' | 'warning' | 'critical' | 'exceeded';
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

const UNLIMITED = -1;
const WARNING_THRESHOLD = 80; // 80% of limit
const CRITICAL_THRESHOLD = 95; // 95% of limit

export function useUsage(
  userId: string | null,
  options: {
    includeTrends?: boolean;
    trendDays?: number;
  } = {}
): UseUsageResult {
  const { includeTrends = false, trendDays = 30 } = options;

  const [usage, setUsage] = useState<UsageData | null>(null);
  const [trends, setTrends] = useState<Record<UsageMetric, UsageTrend[]> | null>(null);
  const [stats, setStats] = useState<Record<UsageMetric, UsageStats> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Get limits from entitlement
  const { limits } = useEntitlement(userId);

  const fetchUsage = useCallback(async () => {
    if (!userId) {
      setUsage(null);
      setTrends(null);
      setStats(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Build query parameters
      const params = new URLSearchParams();
      if (includeTrends) {
        params.append('history', 'true');
        params.append('days', trendDays.toString());
      }

      const response = await apiFetch(`/api/usage/${userId}?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch usage: ${response.statusText}`);
      }

      const data = await response.json();

      // Transform API response to UsageData
      const usageData: UsageData = {
        users: transformMetric('users', data.usage.users, limits?.users || 0),
        storage: transformMetric('storage', data.usage.storage, limits?.storage || 0),
        apiCalls: transformMetric('apiCalls', data.usage.apiCalls, limits?.apiCalls || 0),
        plugins: transformMetric('plugins', data.usage.plugins, limits?.plugins || 0),
      };

      setUsage(usageData);

      // Set trends if included
      if (includeTrends && data.history) {
        setTrends(data.history);
      }

      // Set stats if included
      if (data.stats) {
        setStats(data.stats);
      }
    } catch (error) {
      setError(error instanceof Error ? error : new Error('Failed to fetch usage'));
      setUsage(null);
      setTrends(null);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [userId, includeTrends, trendDays, limits]);

  useEffect(() => {
    void fetchUsage();
  }, [fetchUsage]);

  /**
   * Calculate percentage for each metric
   */
  const percentages: Record<UsageMetric, number> = {
    users: calculatePercentage(usage?.users),
    storage: calculatePercentage(usage?.storage),
    apiCalls: calculatePercentage(usage?.apiCalls),
    plugins: calculatePercentage(usage?.plugins),
  };

  /**
   * Check if approaching limit (default 80%)
   */
  const isApproachingLimit = useCallback(
    (metric: UsageMetric, threshold: number = WARNING_THRESHOLD): boolean => {
      if (!usage) return false;
      const metricData = usage[metric];
      if (metricData.isUnlimited) return false;
      return metricData.percentage >= threshold;
    },
    [usage]
  );

  /**
   * Check if over limit
   */
  const isOverLimit = useCallback(
    (metric: UsageMetric): boolean => {
      if (!usage) return false;
      const metricData = usage[metric];
      if (metricData.isUnlimited) return false;
      return !metricData.allowed;
    },
    [usage]
  );

  /**
   * Get status for a metric
   */
  const getMetricStatus = useCallback(
    (metric: UsageMetric): 'ok' | 'warning' | 'critical' | 'exceeded' => {
      if (!usage) return 'ok';

      const metricData = usage[metric];
      if (metricData.isUnlimited) return 'ok';

      const percentage = metricData.percentage;

      if (!metricData.allowed || percentage > 100) return 'exceeded';
      if (percentage >= CRITICAL_THRESHOLD) return 'critical';
      if (percentage >= WARNING_THRESHOLD) return 'warning';
      return 'ok';
    },
    [usage]
  );

  return {
    usage,
    trends,
    stats,
    percentages,
    isApproachingLimit,
    isOverLimit,
    getMetricStatus,
    loading,
    error,
    refetch: fetchUsage,
  };
}

/**
 * Transform metric data
 */
function transformMetric(metric: UsageMetric, current: number, limit: number): UsageMetricData {
  const isUnlimited = limit === UNLIMITED;
  const percentage = isUnlimited ? 0 : (current / limit) * 100;
  const allowed = isUnlimited || current <= limit;

  return {
    current,
    limit: isUnlimited ? Infinity : limit,
    percentage,
    allowed,
    isUnlimited,
  };
}

/**
 * Calculate percentage for a metric
 */
function calculatePercentage(metric: UsageMetricData | undefined): number {
  if (!metric || metric.isUnlimited) return 0;
  return Math.min(100, metric.percentage);
}

/**
 * Hook for getting usage warnings
 */
export function useUsageWarnings(userId: string | null) {
  const { usage, getMetricStatus, loading } = useUsage(userId);

  const warnings: Array<{
    metric: UsageMetric;
    status: 'warning' | 'critical' | 'exceeded';
    message: string;
    current: number;
    limit: number;
    percentage: number;
  }> = [];

  if (!usage || loading) {
    return { warnings, hasWarnings: false, hasCritical: false };
  }

  const metrics: UsageMetric[] = ['users', 'storage', 'apiCalls', 'plugins'];

  for (const metric of metrics) {
    const status = getMetricStatus(metric);
    if (status !== 'ok') {
      const metricData = usage[metric];
      warnings.push({
        metric,
        status,
        message: getWarningMessage(metric, status, metricData),
        current: metricData.current,
        limit: metricData.limit,
        percentage: metricData.percentage,
      });
    }
  }

  const hasWarnings = warnings.length > 0;
  const hasCritical = warnings.some((w) => w.status === 'critical' || w.status === 'exceeded');

  return { warnings, hasWarnings, hasCritical };
}

/**
 * Generate warning message
 */
function getWarningMessage(
  metric: UsageMetric,
  status: 'warning' | 'critical' | 'exceeded',
  data: UsageMetricData
): string {
  const metricName = {
    users: 'Users',
    storage: 'Storage',
    apiCalls: 'API Calls',
    plugins: 'Plugins',
  }[metric];

  if (status === 'exceeded') {
    return `${metricName} limit exceeded. Current: ${formatMetricValue(metric, data.current)}, Limit: ${formatMetricValue(metric, data.limit)}`;
  }

  if (status === 'critical') {
    return `${metricName} usage is critically high (${Math.round(data.percentage)}%). Consider upgrading your plan.`;
  }

  return `${metricName} usage is at ${Math.round(data.percentage)}% of your limit.`;
}

/**
 * Format metric value for display
 */
export function formatMetricValue(metric: UsageMetric, value: number): string {
  if (value === Infinity) return 'Unlimited';

  switch (metric) {
    case 'storage':
      // Convert MB to appropriate unit
      if (value >= 1024) {
        return `${(value / 1024).toFixed(1)} GB`;
      }
      return `${value} MB`;

    case 'apiCalls':
      // Format with thousands separator
      if (value >= 1000000) {
        return `${(value / 1000000).toFixed(1)}M`;
      }
      if (value >= 1000) {
        return `${(value / 1000).toFixed(1)}K`;
      }
      return value.toString();

    default:
      return value.toString();
  }
}

/**
 * Get color class based on metric status
 */
export function getStatusColor(status: 'ok' | 'warning' | 'critical' | 'exceeded'): string {
  switch (status) {
    case 'ok':
      return 'text-green-600 bg-green-50';
    case 'warning':
      return 'text-amber-600 bg-amber-50';
    case 'critical':
      return 'text-orange-600 bg-orange-50';
    case 'exceeded':
      return 'text-red-600 bg-red-50';
  }
}

/**
 * Get progress bar color based on metric status
 */
export function getProgressBarColor(status: 'ok' | 'warning' | 'critical' | 'exceeded'): string {
  switch (status) {
    case 'ok':
      return 'bg-green-500';
    case 'warning':
      return 'bg-amber-500';
    case 'critical':
      return 'bg-orange-500';
    case 'exceeded':
      return 'bg-red-500';
  }
}
