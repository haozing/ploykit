export interface DashboardTimingSpan {
  name: string;
  durationMs: number;
}

export interface DashboardTimingReportInput {
  requestId?: string;
  pathname: string;
  routeKind: 'dashboard';
  spans: readonly DashboardTimingSpan[];
  totalMs: number;
  moduleId?: string;
  routePath?: string;
  matchedPath?: string;
  status?: number;
  loaderDataBytes?: number | null;
  loaderDataSizeUnavailableReason?: string;
  metadataBytes?: number | null;
  metadataSizeUnavailableReason?: string;
  cachePolicy?: {
    strategy: 'none' | 'public' | 'private';
    revalidateSeconds?: number;
  } | null;
  cacheHit?: boolean | null;
}

export interface DashboardTimingReport extends DashboardTimingReportInput {
  kind: 'dashboard-timing';
  slow: boolean;
}

const DEFAULT_SLOW_THRESHOLD_MS = 1000;
const DEFAULT_TIMING_BUFFER_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMING_BUFFER_LIMIT = 200;
const DEFAULT_SAFE_SIZE_LIMIT_BYTES = 512 * 1024;
const DASHBOARD_TIMING_BUFFER_KEY = Symbol.for('ploykit.dashboardTimingBuffer');

interface DashboardTimingBufferState {
  reports: Map<string, { report: DashboardTimingReport; expiresAt: number }>;
}

function dashboardTimingBufferGlobal(): typeof globalThis & {
  [DASHBOARD_TIMING_BUFFER_KEY]?: DashboardTimingBufferState;
} {
  return globalThis as typeof globalThis & {
    [DASHBOARD_TIMING_BUFFER_KEY]?: DashboardTimingBufferState;
  };
}

function dashboardTimingBufferState(): DashboardTimingBufferState {
  const globals = dashboardTimingBufferGlobal();
  globals[DASHBOARD_TIMING_BUFFER_KEY] ??= { reports: new Map() };
  return globals[DASHBOARD_TIMING_BUFFER_KEY];
}

function dashboardTimingBufferTtlMs(): number {
  const value = Number(process.env.PLOYKIT_DASHBOARD_TIMING_BUFFER_TTL_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMING_BUFFER_TTL_MS;
}

function dashboardTimingBufferLimit(): number {
  const value = Number(process.env.PLOYKIT_DASHBOARD_TIMING_BUFFER_LIMIT);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_TIMING_BUFFER_LIMIT;
}

function pruneDashboardTimingBuffer(now = Date.now()): void {
  const reports = dashboardTimingBufferState().reports;
  for (const [requestId, entry] of reports.entries()) {
    if (entry.expiresAt <= now) {
      reports.delete(requestId);
    }
  }

  const limit = dashboardTimingBufferLimit();
  while (reports.size > limit) {
    const oldest = reports.keys().next().value as string | undefined;
    if (!oldest) {
      break;
    }
    reports.delete(oldest);
  }
}

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

export function rememberDashboardTiming(report: DashboardTimingReport): void {
  if (!report.requestId) {
    return;
  }

  const now = Date.now();
  const reports = dashboardTimingBufferState().reports;
  reports.set(report.requestId, {
    report,
    expiresAt: now + dashboardTimingBufferTtlMs(),
  });
  pruneDashboardTimingBuffer(now);
}

export function readDashboardTimingReport(requestId: string): DashboardTimingReport | null {
  pruneDashboardTimingBuffer();
  const entry = dashboardTimingBufferState().reports.get(requestId);
  return entry?.report ?? null;
}

export function resetDashboardTimingReportsForTests(): void {
  dashboardTimingBufferGlobal()[DASHBOARD_TIMING_BUFFER_KEY] = undefined;
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
  rememberDashboardTiming(report);

  if (!report.slow && process.env.PLOYKIT_DASHBOARD_TIMING_LOG !== 'always') {
    return;
  }

  console.info(JSON.stringify(report));
}

export function safeJsonByteSize(
  value: unknown,
  limitBytes = DEFAULT_SAFE_SIZE_LIMIT_BYTES
): { bytes: number | null; reason?: string } {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) {
      return { bytes: 0 };
    }
    const bytes = new TextEncoder().encode(json).byteLength;
    if (bytes > limitBytes) {
      return { bytes: null, reason: `exceeds-limit:${limitBytes}` };
    }
    return { bytes };
  } catch (error) {
    return {
      bytes: null,
      reason: error instanceof Error ? error.message : 'unserializable',
    };
  }
}
