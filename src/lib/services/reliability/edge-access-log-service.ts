import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { nanoid } from 'nanoid';

import { db } from '@/lib/db';
import { edgeAccessLogs } from '@/lib/db/schema';

export const edgeAccessLogInputSchema = z.object({
  id: z.string().min(1).optional(),
  source: z.string().min(1).default('api_gateway'),
  requestId: z.string().min(1).optional(),
  method: z.string().min(1),
  path: z.string().min(1),
  statusCode: z.number().int().min(100).max(599),
  durationMs: z.number().int().nonnegative().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  userId: z.string().optional(),
  apiKeyId: z.string().optional(),
  region: z.string().optional(),
  failureType: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  occurredAt: z.coerce.date().optional(),
});

export const edgeAccessLogBatchSchema = z.object({
  logs: z.array(edgeAccessLogInputSchema).min(1).max(1000),
});

export type EdgeAccessLogInput = z.input<typeof edgeAccessLogInputSchema>;

function inferFailureType(statusCode: number, explicit?: string): string | undefined {
  if (explicit) return explicit;
  if (statusCode < 400) return undefined;
  if (statusCode === 401 || statusCode === 403) return 'auth';
  if (statusCode === 404) return 'not_found';
  if (statusCode === 429) return 'rate_limited';
  if (statusCode >= 500) return 'upstream';
  return 'client';
}

export async function ingestEdgeAccessLogs(input: { logs: EdgeAccessLogInput[] }) {
  const parsed = edgeAccessLogBatchSchema.parse(input);
  const now = new Date();
  const rows = parsed.logs.map((log) => ({
    ...log,
    id: log.id ?? `edge_${nanoid()}`,
    failureType: inferFailureType(log.statusCode, log.failureType),
    metadata: log.metadata ?? {},
    occurredAt: log.occurredAt ?? now,
    createdAt: now,
  }));

  await db.insert(edgeAccessLogs).values(rows).onConflictDoNothing();

  return {
    received: parsed.logs.length,
    inserted: rows.length,
  };
}

export async function listEdgeAccessLogs(options: {
  days?: number;
  failureType?: string;
  limit?: number;
}) {
  const days = options.days ?? 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const conditions = [gte(edgeAccessLogs.occurredAt, since)];

  if (options.failureType) {
    conditions.push(eq(edgeAccessLogs.failureType, options.failureType));
  }

  return db
    .select()
    .from(edgeAccessLogs)
    .where(and(...conditions))
    .orderBy(desc(edgeAccessLogs.occurredAt))
    .limit(Math.min(Math.max(options.limit ?? 100, 1), 500));
}

export async function getEdgeAccessLogStats(options: { days?: number; failureType?: string }) {
  const days = options.days ?? 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const conditions = [gte(edgeAccessLogs.occurredAt, since)];

  if (options.failureType) {
    conditions.push(eq(edgeAccessLogs.failureType, options.failureType));
  }

  const [summary, byFailureType, trend] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        failed: sql<number>`count(*) filter (where ${edgeAccessLogs.statusCode} >= 400)::int`,
        p95DurationMs: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${edgeAccessLogs.durationMs}), 0)::int`,
      })
      .from(edgeAccessLogs)
      .where(and(...conditions)),
    db
      .select({
        failureType: edgeAccessLogs.failureType,
        count: sql<number>`count(*)::int`,
      })
      .from(edgeAccessLogs)
      .where(and(...conditions, sql`${edgeAccessLogs.failureType} IS NOT NULL`))
      .groupBy(edgeAccessLogs.failureType)
      .orderBy(sql`count(*) desc`),
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${edgeAccessLogs.occurredAt}), 'YYYY-MM-DD')`,
        total: sql<number>`count(*)::int`,
        failed: sql<number>`count(*) filter (where ${edgeAccessLogs.statusCode} >= 400)::int`,
      })
      .from(edgeAccessLogs)
      .where(and(...conditions))
      .groupBy(sql`date_trunc('day', ${edgeAccessLogs.occurredAt})`)
      .orderBy(sql`date_trunc('day', ${edgeAccessLogs.occurredAt})`),
  ]);

  return {
    summary: summary[0] ?? { total: 0, failed: 0, p95DurationMs: 0 },
    byFailureType,
    trend,
  };
}
