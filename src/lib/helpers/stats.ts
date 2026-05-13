/**
 * Statistics Query Helper
 *
 * Provides reusable statistics query utilities to reduce code duplication
 */

import { sql, SQL, eq } from 'drizzle-orm';
import { PgTable, PgColumn } from 'drizzle-orm/pg-core';
import { db } from '@/lib/db';

/**
 * Count records by status
 *
 * @example
 * ```typescript
 * const counts = await countByStatus(users, ['active', 'suspended', 'deleted']);
 * // Result: { active: 10, suspended: 2, deleted: 3 }
 * ```
 */
export async function countByStatus<T extends PgTable>(
  table: T,
  statusColumn: PgColumn,
  statuses: string[]
): Promise<Record<string, number>> {
  const results = await db
    .select({
      status: statusColumn,
      count: sql<number>`count(*)`,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from(table as any)
    .where(
      sql`${statusColumn} IN (${sql.join(
        statuses.map((s) => sql`${s}`),
        sql`, `
      )})`
    )
    .groupBy(statusColumn);

  // Convert to object
  const counts: Record<string, number> = {};
  for (const status of statuses) {
    counts[status] = 0;
  }

  for (const result of results) {
    counts[result.status as string] = Number(result.count);
  }

  return counts;
}

/**
 * Count all records in a table
 *
 * @example
 * ```typescript
 * const total = await countAll(users);
 * ```
 */
export async function countAll<T extends PgTable>(table: T, whereClause?: SQL): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = db.select({ count: sql<number>`count(*)` }).from(table as any);

  const result = whereClause ? await query.where(whereClause) : await query;

  return Number(result[0]?.count || 0);
}

/**
 * Count records with a condition
 *
 * @example
 * ```typescript
 * const activeCount = await countWhere(
 *   users,
 *   eq(users.status, 'active')
 * );
 * ```
 */
export async function countWhere<T extends PgTable>(table: T, condition: SQL): Promise<number> {
  return countAll(table, condition);
}

/**
 * Get statistics summary for a table with status field
 *
 * @example
 * ```typescript
 * const stats = await getStatusStats(users, users.status, ['active', 'suspended', 'deleted']);
 * // Result: { total: 15, active: 10, suspended: 2, deleted: 3 }
 * ```
 */
export async function getStatusStats<T extends PgTable>(
  table: T,
  statusColumn: PgColumn,
  statuses: string[]
): Promise<{ total: number } & Record<string, number>> {
  const [total, counts] = await Promise.all([
    countAll(table),
    countByStatus(table, statusColumn, statuses),
  ]);

  return {
    total,
    ...counts,
  };
}

/**
 * Get top N records by count in a grouped query
 *
 * @example
 * ```typescript
 * const topActions = await getTopByCount(
 *   auditLogs,
 *   auditLogs.action,
 *   10
 * );
 * // Result: [{ action: 'user.login', count: 500 }, ...]
 * ```
 */
export async function getTopByCount<T extends PgTable>(
  table: T,
  groupColumn: PgColumn,
  limit: number = 10,
  whereClause?: SQL
): Promise<Array<{ value: string; count: number }>> {
  const baseQuery = db
    .select({
      value: groupColumn,
      count: sql<number>`count(*)`,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from(table as any)
    .groupBy(groupColumn)
    .orderBy(sql`count(*) desc`)
    .limit(limit);

  const query = whereClause ? baseQuery.where(whereClause) : baseQuery;

  const results = await query;

  return results.map((r) => ({
    value: String(r.value),
    count: Number(r.count),
  }));
}

/**
 * Get distribution of records across a field
 *
 * @example
 * ```typescript
 * const distribution = await getDistribution(
 *   userEntitlements,
 *   userEntitlements.planId,
 *   entitlementPlans,
 *   entitlementPlans.name
 * );
 * // Result: { 'Free': 100, 'Pro': 50, 'Enterprise': 10 }
 * ```
 */
export async function getDistribution<T extends PgTable, U extends PgTable>(
  table: T,
  foreignKeyColumn: PgColumn,
  joinTable: U,
  labelColumn: PgColumn,
  whereClause?: SQL
): Promise<Record<string, number>> {
  const baseQuery = db
    .select({
      label: labelColumn,
      count: sql<number>`count(*)`,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from(table as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .innerJoin(joinTable as any, eq(foreignKeyColumn, sql`${joinTable}.id`))
    .groupBy(labelColumn);

  const query = whereClause ? baseQuery.where(whereClause) : baseQuery;

  const results = await query;

  const distribution: Record<string, number> = {};
  for (const result of results) {
    distribution[String(result.label)] = Number(result.count);
  }

  return distribution;
}

/**
 * Calculate percentage distribution
 *
 * @example
 * ```typescript
 * const percentages = calculatePercentages({ active: 80, suspended: 15, deleted: 5 });
 * // Result: { active: 80%, suspended: 15%, deleted: 5% }
 * ```
 */
export function calculatePercentages(counts: Record<string, number>): Record<string, string> {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

  if (total === 0) {
    return Object.keys(counts).reduce(
      (acc, key) => {
        acc[key] = '0%';
        return acc;
      },
      {} as Record<string, string>
    );
  }

  return Object.entries(counts).reduce(
    (acc, [key, count]) => {
      acc[key] = `${Math.round((count / total) * 100)}%`;
      return acc;
    },
    {} as Record<string, string>
  );
}

/**
 * Get time-based statistics (count by time period)
 *
 * @example
 * ```typescript
 * const dailyStats = await getTimeSeries(
 *   auditLogs,
 *   auditLogs.createdAt,
 *   'day',
 *   7  // last 7 days
 * );
 * ```
 */
export async function getTimeSeries<T extends PgTable>(
  table: T,
  timestampColumn: PgColumn,
  interval: 'hour' | 'day' | 'week' | 'month',
  periods: number
): Promise<Array<{ date: string; count: number }>> {
  const _intervalMap = {
    hour: '1 hour',
    day: '1 day',
    week: '1 week',
    month: '1 month',
  };

  const results = await db
    .select({
      date: sql<string>`date_trunc('${sql.raw(interval)}', ${timestampColumn})::text`,
      count: sql<number>`count(*)`,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from(table as any)
    .where(
      sql`${timestampColumn} >= NOW() - INTERVAL '${sql.raw(periods.toString())} ${sql.raw(interval)}'`
    )
    .groupBy(sql`date_trunc('${sql.raw(interval)}', ${timestampColumn})`)
    .orderBy(sql`date_trunc('${sql.raw(interval)}', ${timestampColumn})`);

  return results.map((r) => ({
    date: r.date,
    count: Number(r.count),
  }));
}

/**
 * Aggregate numeric field with common operations
 *
 * @example
 * ```typescript
 * const storageStats = await aggregateField(
 *   files,
 *   files.size,
 *   eq(files.userId, userId)
 * );
 * // Result: { sum: 1000000, avg: 50000, min: 1000, max: 500000, count: 20 }
 * ```
 */
export async function aggregateField<T extends PgTable>(
  table: T,
  fieldColumn: PgColumn,
  whereClause?: SQL
): Promise<{
  sum: number;
  avg: number;
  min: number;
  max: number;
  count: number;
}> {
  const baseQuery = db
    .select({
      sum: sql<number>`COALESCE(SUM(${fieldColumn}), 0)`,
      avg: sql<number>`COALESCE(AVG(${fieldColumn}), 0)`,
      min: sql<number>`COALESCE(MIN(${fieldColumn}), 0)`,
      max: sql<number>`COALESCE(MAX(${fieldColumn}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from(table as any);

  const query = whereClause ? baseQuery.where(whereClause) : baseQuery;

  const [result] = await query;

  return {
    sum: Number(result?.sum || 0),
    avg: Number(result?.avg || 0),
    min: Number(result?.min || 0),
    max: Number(result?.max || 0),
    count: Number(result?.count || 0),
  };
}
