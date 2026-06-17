import type { ModuleDataPostgresExecutor } from '../data';

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export interface RateLimitInput {
  bucket: string;
  cost?: number;
  rule: RateLimitRule;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: string;
}

export interface RateLimiter {
  check(input: RateLimitInput): RateLimitResult | Promise<RateLimitResult>;
  reset?(bucket?: string): void | Promise<void>;
}

interface BucketState {
  count: number;
  resetAt: number;
}

function positiveCost(cost: number | undefined): number {
  return Number.isFinite(cost) && (cost ?? 1) > 0 ? Math.ceil(cost ?? 1) : 1;
}

export function createInMemoryRateLimiter(options: { now?: () => Date } = {}): RateLimiter {
  const now = options.now ?? (() => new Date());
  const buckets = new Map<string, BucketState>();

  return {
    check(input) {
      const timestamp = now().getTime();
      const cost = positiveCost(input.cost);
      const current = buckets.get(input.bucket);
      const state =
        !current || current.resetAt <= timestamp
          ? { count: 0, resetAt: timestamp + input.rule.windowMs }
          : current;
      const nextCount = state.count + cost;
      buckets.set(input.bucket, { ...state, count: nextCount });
      return {
        ok: nextCount <= input.rule.limit,
        remaining: Math.max(0, input.rule.limit - nextCount),
        resetAt: new Date(state.resetAt).toISOString(),
      };
    },
    reset(bucket) {
      if (bucket) {
        buckets.delete(bucket);
      } else {
        buckets.clear();
      }
    },
  };
}

export function createPostgresSlidingWindowRateLimiter(options: {
  database: ModuleDataPostgresExecutor;
  now?: () => Date;
}): RateLimiter {
  const now = options.now ?? (() => new Date());

  async function checkWithExecutor(
    database: ModuleDataPostgresExecutor,
    input: RateLimitInput
  ): Promise<RateLimitResult> {
    const timestamp = now().getTime();
    const cost = positiveCost(input.cost);
    const windowStart = new Date(timestamp - input.rule.windowMs).toISOString();
    const occurredAt = new Date(timestamp).toISOString();

    await database.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [input.bucket]);
    await database.query(
      `delete from module_rate_limit_events
       where bucket = $1 and occurred_at <= $2::timestamptz`,
      [input.bucket, windowStart]
    );
    const current = await database.query<{ total: string | number | null }>(
      `select coalesce(sum(cost), 0)::int as total
       from module_rate_limit_events
       where bucket = $1 and occurred_at > $2::timestamptz`,
      [input.bucket, windowStart]
    );
    const currentTotal = Number(current.rows[0]?.total ?? 0);
    const nextTotal = currentTotal + cost;
    await database.query(
      `insert into module_rate_limit_events (bucket, cost, occurred_at, expires_at)
       values ($1, $2, $3::timestamptz, $4::timestamptz)`,
      [
        input.bucket,
        cost,
        occurredAt,
        new Date(timestamp + input.rule.windowMs).toISOString(),
      ]
    );
    const oldest = await database.query<{ occurred_at: Date | string | null }>(
      `select min(occurred_at) as occurred_at
       from module_rate_limit_events
       where bucket = $1 and occurred_at > $2::timestamptz`,
      [input.bucket, windowStart]
    );
    const oldestAt = oldest.rows[0]?.occurred_at
      ? new Date(String(oldest.rows[0].occurred_at)).getTime()
      : timestamp;
    return {
      ok: nextTotal <= input.rule.limit,
      remaining: Math.max(0, input.rule.limit - nextTotal),
      resetAt: new Date(oldestAt + input.rule.windowMs).toISOString(),
    };
  }

  return {
    async check(input) {
      if (!options.database.transaction) {
        throw new Error('RATE_LIMIT_TRANSACTION_REQUIRED: Postgres rate limiting requires transaction support');
      }
      return options.database.transaction((tx) => checkWithExecutor(tx, input));
    },
    async reset(bucket) {
      if (bucket) {
        await options.database.query('delete from module_rate_limit_events where bucket = $1', [
          bucket,
        ]);
      } else {
        await options.database.query('delete from module_rate_limit_events');
      }
    },
  };
}

export function createRateLimitBucket(input: {
  productId: string;
  workspaceId?: string | null;
  userId?: string | null;
  ipPrefix?: string | null;
  route?: string;
  kind: 'public' | 'machine' | 'login' | 'high-cost';
}): string {
  return [
    input.kind,
    input.productId,
    input.workspaceId ?? 'product',
    input.userId ?? 'anonymous',
    input.ipPrefix ?? 'ip:any',
    input.route ?? 'route:any',
  ].join(':');
}
