import type { HostRuntimeStoreStatus } from '@host/lib/runtime-store';

export type AdminAnalyticsData = {
  range: { label: string; from: string; to: string };
  counts: Record<string, number>;
  revenueMetrics: Record<string, number>;
  growthMetrics: Record<string, number>;
  churnMetrics: {
    churnCount: number;
    churnRate: number;
    lostMrr: number;
    reasons: Record<string, number>;
  };
  usagePatterns: {
    byModule: Record<string, number>;
    byMeter: Record<string, number>;
    peak: number;
    median: number;
  };
  timeSeries: {
    date: string;
    usageQuantity: number;
    revenueAmount: number;
    signups: number;
    failedRuns: number;
    failedWebhooks: number;
    deadLetters: number;
    p95LatencyMs: number;
  }[];
  usageTrends: { date: string; quantity: number }[];
  cohorts: {
    cohort: string;
    size: number;
    retained: number;
    retentionRate: number;
    revenue: number;
  }[];
  reliability: {
    failedRuns: number;
    failedWebhooks: number;
    deadLetters: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    warnings: string[];
  };
  edgeAccessLogs: {
    route: string;
    status: number;
    ipHash: string;
    latencyMs: number;
    userAgent: string;
    createdAt: string;
  }[];
  store: HostRuntimeStoreStatus;
};

const EMPTY_TIME_SERIES_POINT = {
  date: '-',
  usageQuantity: 0,
  revenueAmount: 0,
  signups: 0,
  failedRuns: 0,
  failedWebhooks: 0,
  deadLetters: 0,
  p95LatencyMs: 0,
};

export function compactJson(value: unknown, maxLength = Number.POSITIVE_INFINITY): string {
  if (value === undefined) {
    return '';
  }
  const text = JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

export function buildAnalyticsEvidenceModel(analytics: AdminAnalyticsData) {
  const timeSeries = analytics.timeSeries.slice(-14);
  const zeroBuckets = analytics.timeSeries.filter(
    (point) =>
      point.usageQuantity === 0 &&
      point.revenueAmount === 0 &&
      point.signups === 0 &&
      point.failedRuns === 0 &&
      point.failedWebhooks === 0 &&
      point.deadLetters === 0
  ).length;
  const failureBuckets = analytics.timeSeries.filter(
    (point) => point.failedRuns + point.failedWebhooks + point.deadLetters > 0
  ).length;
  const peakUsageBucket = analytics.timeSeries.reduce(
    (best, point) => (point.usageQuantity > best.usageQuantity ? point : best),
    analytics.timeSeries[0] ?? EMPTY_TIME_SERIES_POINT
  );
  const peakRevenueBucket = analytics.timeSeries.reduce(
    (best, point) => (point.revenueAmount > best.revenueAmount ? point : best),
    analytics.timeSeries[0] ?? peakUsageBucket
  );

  return {
    countEntries: Object.entries(analytics.counts),
    growthEntries: Object.entries(analytics.growthMetrics),
    timeSeries,
    zeroBuckets,
    failureBuckets,
    peakUsageBucket,
    peakRevenueBucket,
  };
}

export type AnalyticsEvidenceModel = ReturnType<typeof buildAnalyticsEvidenceModel>;
