import { NextResponse, type NextRequest } from 'next/server';
import { gte, sql } from 'drizzle-orm';

import { ValidationError } from '@/lib/_core/errors';
import { db } from '@/lib/db';
import {
  edgeAccessLogs,
  eventOutbox,
  pluginJobRuns,
  webhookLogs,
  webhookRetries,
} from '@/lib/db/schema';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';

const DEFAULT_RANGE_DAYS = 30;
const MIN_RANGE_DAYS = 1;
const MAX_RANGE_DAYS = 365;

type CountRow = Record<string, number | string | Date | null | undefined>;
type ReliabilityTrendMetricRow = {
  day: string;
  failed: number;
};

function readRangeDays(request: NextRequest): number {
  const rawDays = new URL(request.url).searchParams.get('days');
  const days = rawDays === null ? DEFAULT_RANGE_DAYS : Number(rawDays);

  if (!Number.isInteger(days) || days < MIN_RANGE_DAYS || days > MAX_RANGE_DAYS) {
    throw new ValidationError('days must be an integer between 1 and 365', {
      fields: ['days'],
      min: MIN_RANGE_DAYS,
      max: MAX_RANGE_DAYS,
    });
  }

  return days;
}

function readFailureType(request: NextRequest): string | undefined {
  const raw = new URL(request.url).searchParams.get('failureType');
  return raw?.trim() || undefined;
}

function toNumber(row: CountRow | undefined, key: string): number {
  return Number(row?.[key] ?? 0);
}

function failureRate(failed: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return Number(((failed / total) * 100).toFixed(2));
}

/**
 * GET /api/admin/analytics/reliability
 *
 * Returns queue and async processing reliability metrics for admin analytics.
 */
export const GET = withAdminGuard(
  withErrorHandling(async (request: NextRequest) => {
    const rangeDays = readRangeDays(request);
    const failureType = readFailureType(request);
    const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
    const edgeConditions = [gte(edgeAccessLogs.occurredAt, since)];
    if (failureType) {
      edgeConditions.push(sql`${edgeAccessLogs.failureType} = ${failureType}`);
    }

    const [
      outboxRows,
      webhookRows,
      webhookRetryRows,
      jobRows,
      outboxTrendRows,
      webhookTrendRows,
      jobTrendRows,
      edgeRows,
      edgeFailureRows,
    ] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)::int`,
          pending: sql<number>`count(*) filter (where ${eventOutbox.status} = 'pending')::int`,
          processing: sql<number>`count(*) filter (where ${eventOutbox.status} = 'processing')::int`,
          completed: sql<number>`count(*) filter (where ${eventOutbox.status} = 'completed')::int`,
          failed: sql<number>`count(*) filter (where ${eventOutbox.status} = 'failed')::int`,
          readyPending: sql<number>`count(*) filter (where ${eventOutbox.status} = 'pending' and ${eventOutbox.nextAttemptAt} <= now())::int`,
          oldestFailedAt: sql<Date | null>`min(${eventOutbox.updatedAt}) filter (where ${eventOutbox.status} = 'failed')`,
        })
        .from(eventOutbox)
        .where(gte(eventOutbox.createdAt, since)),
      db
        .select({
          total: sql<number>`count(*)::int`,
          received: sql<number>`count(*) filter (where ${webhookLogs.status} = 'received')::int`,
          processing: sql<number>`count(*) filter (where ${webhookLogs.status} = 'processing')::int`,
          processed: sql<number>`count(*) filter (where ${webhookLogs.status} in ('processed', 'completed'))::int`,
          failed: sql<number>`count(*) filter (where ${webhookLogs.status} = 'failed')::int`,
          deadLetter: sql<number>`count(*) filter (where ${webhookLogs.status} = 'dead_letter')::int`,
          retryable: sql<number>`count(*) filter (where ${webhookLogs.status} in ('received', 'processing', 'failed', 'dead_letter'))::int`,
          oldestFailedAt: sql<Date | null>`min(${webhookLogs.updatedAt}) filter (where ${webhookLogs.status} in ('failed', 'dead_letter'))`,
        })
        .from(webhookLogs)
        .where(gte(webhookLogs.createdAt, since)),
      db
        .select({
          total: sql<number>`count(*)::int`,
          succeeded: sql<number>`count(*) filter (where ${webhookRetries.status} in ('success', 'succeeded', 'processed'))::int`,
          failed: sql<number>`count(*) filter (where ${webhookRetries.status} = 'failed')::int`,
        })
        .from(webhookRetries)
        .where(gte(webhookRetries.retriedAt, since)),
      db
        .select({
          total: sql<number>`count(*)::int`,
          running: sql<number>`count(*) filter (where ${pluginJobRuns.status} = 'running')::int`,
          succeeded: sql<number>`count(*) filter (where ${pluginJobRuns.status} = 'succeeded')::int`,
          deadLetter: sql<number>`count(*) filter (where ${pluginJobRuns.status} = 'dead_letter')::int`,
          oldestDeadLetteredAt: sql<Date | null>`min(${pluginJobRuns.deadLetteredAt}) filter (where ${pluginJobRuns.status} = 'dead_letter')`,
        })
        .from(pluginJobRuns)
        .where(gte(pluginJobRuns.createdAt, since)),
      db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${eventOutbox.createdAt}), 'YYYY-MM-DD')`,
          failed: sql<number>`count(*) filter (where ${eventOutbox.status} = 'failed')::int`,
        })
        .from(eventOutbox)
        .where(gte(eventOutbox.createdAt, since))
        .groupBy(sql`date_trunc('day', ${eventOutbox.createdAt})`),
      db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${webhookLogs.createdAt}), 'YYYY-MM-DD')`,
          failed: sql<number>`count(*) filter (where ${webhookLogs.status} in ('failed', 'dead_letter'))::int`,
        })
        .from(webhookLogs)
        .where(gte(webhookLogs.createdAt, since))
        .groupBy(sql`date_trunc('day', ${webhookLogs.createdAt})`),
      db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${pluginJobRuns.createdAt}), 'YYYY-MM-DD')`,
          failed: sql<number>`count(*) filter (where ${pluginJobRuns.status} = 'dead_letter')::int`,
        })
        .from(pluginJobRuns)
        .where(gte(pluginJobRuns.createdAt, since))
        .groupBy(sql`date_trunc('day', ${pluginJobRuns.createdAt})`),
      db
        .select({
          total: sql<number>`count(*)::int`,
          failed: sql<number>`count(*) filter (where ${edgeAccessLogs.statusCode} >= 400)::int`,
          p95DurationMs: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${edgeAccessLogs.durationMs}), 0)::int`,
        })
        .from(edgeAccessLogs)
        .where(sql.join(edgeConditions, sql` and `)),
      db
        .select({
          failureType: edgeAccessLogs.failureType,
          count: sql<number>`count(*)::int`,
        })
        .from(edgeAccessLogs)
        .where(
          sql.join([...edgeConditions, sql`${edgeAccessLogs.failureType} IS NOT NULL`], sql` and `)
        )
        .groupBy(edgeAccessLogs.failureType)
        .orderBy(sql`count(*) desc`),
    ]);

    const outboxRow = outboxRows[0];
    const webhookRow = webhookRows[0];
    const webhookRetryRow = webhookRetryRows[0];
    const jobRow = jobRows[0];
    const edgeRow = edgeRows[0];
    const trendMap = new Map<
      string,
      { day: string; outboxFailed: number; webhookFailed: number; jobFailed: number }
    >();
    const mergeTrendRows = (
      rows: ReliabilityTrendMetricRow[],
      key: 'outboxFailed' | 'webhookFailed' | 'jobFailed'
    ) => {
      for (const row of rows) {
        const current = trendMap.get(row.day) ?? {
          day: row.day,
          outboxFailed: 0,
          webhookFailed: 0,
          jobFailed: 0,
        };
        current[key] = Number(row.failed ?? 0);
        trendMap.set(row.day, current);
      }
    };
    mergeTrendRows(outboxTrendRows, 'outboxFailed');
    mergeTrendRows(webhookTrendRows, 'webhookFailed');
    mergeTrendRows(jobTrendRows, 'jobFailed');
    const trendRows = Array.from(trendMap.values()).sort((left, right) =>
      left.day.localeCompare(right.day)
    );

    const outboxTotal = toNumber(outboxRow, 'total');
    const outboxFailed = toNumber(outboxRow, 'failed');
    const webhookTotal = toNumber(webhookRow, 'total');
    const webhookFailed = toNumber(webhookRow, 'failed') + toNumber(webhookRow, 'deadLetter');
    const jobTotal = toNumber(jobRow, 'total');
    const jobFailed = toNumber(jobRow, 'deadLetter');
    const backlog =
      toNumber(outboxRow, 'pending') +
      toNumber(outboxRow, 'processing') +
      toNumber(webhookRow, 'received') +
      toNumber(webhookRow, 'processing') +
      toNumber(jobRow, 'running');
    const totalWorkItems = outboxTotal + webhookTotal + jobTotal;
    const failedWorkItems = outboxFailed + webhookFailed + jobFailed;

    return NextResponse.json({
      success: true,
      rangeDays,
      since: since.toISOString(),
      generatedAt: new Date().toISOString(),
      reliability: {
        outbox: {
          total: outboxTotal,
          pending: toNumber(outboxRow, 'pending'),
          processing: toNumber(outboxRow, 'processing'),
          completed: toNumber(outboxRow, 'completed'),
          failed: outboxFailed,
          readyPending: toNumber(outboxRow, 'readyPending'),
          failureRate: failureRate(outboxFailed, outboxTotal),
          oldestFailedAt: outboxRow?.oldestFailedAt ?? null,
        },
        webhooks: {
          total: webhookTotal,
          received: toNumber(webhookRow, 'received'),
          processing: toNumber(webhookRow, 'processing'),
          processed: toNumber(webhookRow, 'processed'),
          failed: toNumber(webhookRow, 'failed'),
          deadLetter: toNumber(webhookRow, 'deadLetter'),
          retryable: toNumber(webhookRow, 'retryable'),
          retryAttempts: toNumber(webhookRetryRow, 'total'),
          successfulRetryAttempts: toNumber(webhookRetryRow, 'succeeded'),
          failedRetryAttempts: toNumber(webhookRetryRow, 'failed'),
          failureRate: failureRate(webhookFailed, webhookTotal),
          oldestFailedAt: webhookRow?.oldestFailedAt ?? null,
        },
        jobs: {
          total: jobTotal,
          running: toNumber(jobRow, 'running'),
          succeeded: toNumber(jobRow, 'succeeded'),
          deadLetter: jobFailed,
          failureRate: failureRate(jobFailed, jobTotal),
          oldestDeadLetteredAt: jobRow?.oldestDeadLetteredAt ?? null,
        },
        overall: {
          totalWorkItems,
          failedWorkItems,
          backlog,
          hasBacklog: backlog > 0,
          failureRate: failureRate(failedWorkItems, totalWorkItems),
        },
        trend: trendRows,
        edgeAccess: {
          total: toNumber(edgeRow, 'total'),
          failed: toNumber(edgeRow, 'failed'),
          failureRate: failureRate(toNumber(edgeRow, 'failed'), toNumber(edgeRow, 'total')),
          p95DurationMs: toNumber(edgeRow, 'p95DurationMs'),
          byFailureType: edgeFailureRows,
          activeFailureTypeFilter: failureType ?? null,
        },
      },
    });
  })
);
