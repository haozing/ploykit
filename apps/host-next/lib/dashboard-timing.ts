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

function dashboardServerTimingName(name: string): string {
  return name.replace(/[^A-Za-z0-9!#$%&'*+.^_`|~-]+/g, '-').replace(/^-+|-+$/g, '') || 'span';
}

function dashboardServerTimingDuration(durationMs: number): string {
  const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  return Number.isInteger(duration) ? String(duration) : duration.toFixed(1);
}

export function createDashboardServerTimingHeader(
  input: Pick<DashboardTimingReportInput, 'spans' | 'totalMs'>
): string {
  return [
    ...input.spans.map(
      (span) =>
        `${dashboardServerTimingName(span.name)};dur=${dashboardServerTimingDuration(
          span.durationMs
        )}`
    ),
    `total;dur=${dashboardServerTimingDuration(input.totalMs)}`,
  ].join(', ');
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
