export interface DashboardTimingSpan {
  name: string;
  durationMs: number;
}

export interface DashboardTimingReportInput {
  pathname: string;
  routeKind: 'dashboard';
  spans: readonly DashboardTimingSpan[];
  totalMs: number;
  moduleId?: string;
  status?: number;
}

export interface DashboardTimingReport extends DashboardTimingReportInput {
  kind: 'dashboard-timing';
  slow: boolean;
}

const DEFAULT_SLOW_THRESHOLD_MS = 1000;

export function dashboardTimingSlowThresholdMs(): number {
  const value = Number(process.env.PLOYKIT_DASHBOARD_TIMING_SLOW_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_SLOW_THRESHOLD_MS;
}

export function createDashboardTimingReport(
  input: DashboardTimingReportInput,
  thresholdMs = dashboardTimingSlowThresholdMs()
): DashboardTimingReport {
  return {
    kind: 'dashboard-timing',
    ...input,
    slow: input.totalMs >= thresholdMs,
  };
}

export async function measureDashboardSpan<T>(
  name: string,
  spans: DashboardTimingSpan[],
  fn: () => Promise<T> | T
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    spans.push({
      name,
      durationMs: Date.now() - startedAt,
    });
  }
}

export function maybeLogDashboardTiming(report: DashboardTimingReport): void {
  if (!report.slow && process.env.PLOYKIT_DASHBOARD_TIMING_LOG !== 'always') {
    return;
  }

  console.info(JSON.stringify(report));
}
