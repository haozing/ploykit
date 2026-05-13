'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useUsage, UsageMetric } from './use-usage';
import type { UsageAlert } from '@/components/usage/usage-alerts';

/**
 * Usage Notifications Hook
 *
 * Real-time usage monitoring and alert generation
 * Features:
 * - Automatic alert generation based on usage thresholds
 * - Dismissible alerts with local storage persistence
 * - Alert history tracking
 * - Customizable notification preferences
 * - Real-time updates with auto-refresh
 */

export interface NotificationPreferences {
  enabled: boolean;
  showInfo: boolean;
  showWarning: boolean;
  showCritical: boolean;
  showExceeded: boolean;
  autoRefreshInterval?: number; // milliseconds, null to disable
}

interface UseUsageNotificationsOptions {
  userId: string | null;
  preferences?: Partial<NotificationPreferences>;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface UseUsageNotificationsResult {
  alerts: UsageAlert[];
  activeAlerts: UsageAlert[];
  dismissedAlerts: UsageAlert[];
  hasNewAlerts: boolean;
  dismissAlert: (id: string) => void;
  dismissAll: () => void;
  undismissAlert: (id: string) => void;
  clearHistory: () => void;
  preferences: NotificationPreferences;
  updatePreferences: (prefs: Partial<NotificationPreferences>) => void;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: true,
  showInfo: false,
  showWarning: true,
  showCritical: true,
  showExceeded: true,
  autoRefreshInterval: 60000, // 60 seconds
};

const STORAGE_KEY_PREFIX = 'usage-notifications';

/**
 * Hook for managing usage notifications and alerts
 */
// Helper to load from localStorage safely
function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored) as T;
  } catch (error) {
    console.error(`Failed to load from localStorage: ${key}`, error);
  }
  return fallback;
}

export function useUsageNotifications({
  userId,
  preferences: initialPreferences,
  autoRefresh = true,
  refreshInterval: _refreshInterval = 60000,
}: UseUsageNotificationsOptions): UseUsageNotificationsResult {
  // Lazy initialization for preferences (React 19 best practice)
  const [preferences, setPreferences] = useState<NotificationPreferences>(() => {
    const stored = userId
      ? loadFromStorage<Partial<NotificationPreferences>>(
          `${STORAGE_KEY_PREFIX}-preferences-${userId}`,
          {}
        )
      : {};
    return { ...DEFAULT_PREFERENCES, ...initialPreferences, ...stored };
  });

  // Lazy initialization for dismissed IDs
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    const stored = userId
      ? loadFromStorage<string[]>(`${STORAGE_KEY_PREFIX}-dismissed-${userId}`, [])
      : [];
    return new Set(stored);
  });

  const [lastCheckTime, setLastCheckTime] = useState<Date>(() => new Date());

  // Get usage data with auto-refresh
  const { usage, getMetricStatus, refetch } = useUsage(userId, {
    includeTrends: true,
    trendDays: 30,
  });

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh || !preferences.enabled || !preferences.autoRefreshInterval) return;

    const interval = setInterval(() => {
      void refetch();
      setLastCheckTime(new Date());
    }, preferences.autoRefreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, preferences.enabled, preferences.autoRefreshInterval, refetch]);

  // Generate alerts from usage stats
  const generateAlerts = useCallback((): UsageAlert[] => {
    if (!usage || !preferences.enabled) return [];

    const alerts: UsageAlert[] = [];
    const metrics: UsageMetric[] = ['users', 'storage', 'apiCalls', 'plugins'];

    metrics.forEach((metricKey) => {
      const metricData = usage[metricKey];
      const status = getMetricStatus(metricKey);
      const alertId = `${metricKey}-${status}`;

      // Skip if alert type is disabled in preferences
      if (
        (status === 'warning' && !preferences.showWarning) ||
        (status === 'critical' && !preferences.showCritical) ||
        (status === 'exceeded' && !preferences.showExceeded)
      ) {
        return;
      }

      // Skip "ok" status
      if (status === 'ok') return;

      // Generate alert based on status
      let title: string;
      let message: string;

      switch (status) {
        case 'exceeded':
          title = `${getMetricLabel(metricKey)} Limit Exceeded`;
          message = `You have used ${metricData.current.toLocaleString()} ${getMetricUnit(metricKey)}, exceeding your plan limit of ${metricData.limit.toLocaleString()}. Please upgrade your plan to continue.`;
          break;

        case 'critical':
          title = `${getMetricLabel(metricKey)} Critical`;
          message = `You are using ${metricData.percentage.toFixed(1)}% of your ${getMetricLabel(metricKey).toLowerCase()} limit. Upgrade soon to avoid service interruption.`;
          break;

        case 'warning':
          title = `${getMetricLabel(metricKey)} Warning`;
          message = `You have used ${metricData.percentage.toFixed(1)}% of your ${getMetricLabel(metricKey).toLowerCase()} limit. Consider upgrading your plan.`;
          break;

        default:
          // This should not happen, but handle gracefully
          return;
      }

      alerts.push({
        id: alertId,
        metric: metricKey,
        severity: status as UsageAlert['severity'],
        title,
        message,
        percentage: metricData.percentage,
        used: metricData.current,
        allowed: metricData.limit,
        isUnlimited: metricData.isUnlimited,
        timestamp: lastCheckTime,
        dismissed: dismissedIds.has(alertId),
      });
    });

    return alerts;
  }, [usage, getMetricStatus, preferences, dismissedIds, lastCheckTime]);

  const allAlerts = generateAlerts();
  const activeAlerts = allAlerts.filter((a) => !dismissedIds.has(a.id));
  const dismissedAlerts = allAlerts.filter((a) => dismissedIds.has(a.id));

  // Track new alerts state (React 19 best practice: use state + effect with proper pattern)
  const [hasNewAlerts, setHasNewAlerts] = useState(false);
  const previousAlertIdsRef = useRef<Set<string>>(new Set());
  const currentAlertIds = useMemo(() => new Set(allAlerts.map((a) => a.id)), [allAlerts]);

  // Update hasNewAlerts when alerts change - using flushSync alternative pattern
  // This effect runs after render and updates state based on comparison
  useEffect(() => {
    const newAlertFound = activeAlerts.some((alert) => !previousAlertIdsRef.current.has(alert.id));
    // Only update if there's a change to avoid infinite loops
    if (newAlertFound !== hasNewAlerts) {
      setHasNewAlerts(newAlertFound);
    }
    // Update ref for next comparison
    previousAlertIdsRef.current = currentAlertIds;
  }, [activeAlerts, currentAlertIds, hasNewAlerts]);

  // Dismiss an alert
  const dismissAlert = useCallback(
    (id: string) => {
      const newDismissed = new Set(dismissedIds);
      newDismissed.add(id);
      setDismissedIds(newDismissed);

      // Persist to localStorage
      if (typeof window !== 'undefined' && userId) {
        try {
          localStorage.setItem(
            `${STORAGE_KEY_PREFIX}-dismissed-${userId}`,
            JSON.stringify(Array.from(newDismissed))
          );
        } catch (error) {
          console.error('Failed to save dismissed alerts:', error);
        }
      }
    },
    [dismissedIds, userId]
  );

  // Dismiss all alerts
  const dismissAll = useCallback(() => {
    const allIds = new Set(allAlerts.map((a) => a.id));
    setDismissedIds(allIds);

    if (typeof window !== 'undefined' && userId) {
      try {
        localStorage.setItem(
          `${STORAGE_KEY_PREFIX}-dismissed-${userId}`,
          JSON.stringify(Array.from(allIds))
        );
      } catch (error) {
        console.error('Failed to save dismissed alerts:', error);
      }
    }
  }, [allAlerts, userId]);

  // Undismiss an alert
  const undismissAlert = useCallback(
    (id: string) => {
      const newDismissed = new Set(dismissedIds);
      newDismissed.delete(id);
      setDismissedIds(newDismissed);

      if (typeof window !== 'undefined' && userId) {
        try {
          localStorage.setItem(
            `${STORAGE_KEY_PREFIX}-dismissed-${userId}`,
            JSON.stringify(Array.from(newDismissed))
          );
        } catch (error) {
          console.error('Failed to save dismissed alerts:', error);
        }
      }
    },
    [dismissedIds, userId]
  );

  // Clear all history
  const clearHistory = useCallback(() => {
    setDismissedIds(new Set());

    if (typeof window !== 'undefined' && userId) {
      try {
        localStorage.removeItem(`${STORAGE_KEY_PREFIX}-dismissed-${userId}`);
      } catch (error) {
        console.error('Failed to clear alert history:', error);
      }
    }
  }, [userId]);

  // Update preferences
  const updatePreferences = useCallback(
    (newPreferences: Partial<NotificationPreferences>) => {
      const updated = { ...preferences, ...newPreferences };
      setPreferences(updated);

      if (typeof window !== 'undefined' && userId) {
        try {
          localStorage.setItem(
            `${STORAGE_KEY_PREFIX}-preferences-${userId}`,
            JSON.stringify(updated)
          );
        } catch (error) {
          console.error('Failed to save preferences:', error);
        }
      }
    },
    [preferences, userId]
  );

  return {
    alerts: allAlerts,
    activeAlerts,
    dismissedAlerts,
    hasNewAlerts,
    dismissAlert,
    dismissAll,
    undismissAlert,
    clearHistory,
    preferences,
    updatePreferences,
  };
}

/**
 * Helper functions
 */
function getMetricLabel(metric: UsageMetric): string {
  const labels: Record<UsageMetric, string> = {
    users: 'Users',
    plugins: 'Plugins',
    storage: 'Storage',
    apiCalls: 'API Calls',
  };
  return labels[metric] || metric;
}

function getMetricUnit(metric: UsageMetric): string {
  const units: Record<UsageMetric, string> = {
    users: 'users',
    plugins: 'plugins',
    storage: 'MB',
    apiCalls: 'calls',
  };
  return units[metric] || '';
}
