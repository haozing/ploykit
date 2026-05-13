import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import {
  Permission,
  PluginError,
  type PluginRateLimit,
  type PluginRateLimitCheckResult,
} from '@ploykit/plugin-sdk';
import { db, type Database } from '@/lib/db/client.server';
import {
  pluginRateLimitBuckets,
  type PluginRateLimitBucket,
} from '@/lib/db/schema/plugin-platform';
import {
  assertPluginNamespaced,
  currentApiKeyId,
  enforceCapabilityPermission,
  type PluginCapabilityScope,
} from './guards.server';

type TransactionDatabase = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Database | TransactionDatabase;

export interface PluginRateLimitScope {
  pluginId: string;
}

export interface PluginRateLimitRepository {
  check(
    scope: PluginRateLimitScope,
    input: { bucket: string; limit: number; windowMs: number; cost: number; now: Date }
  ): Promise<PluginRateLimitCheckResult>;
}

export interface CreatePluginRateLimitOptions {
  repository?: PluginRateLimitRepository;
}

const WINDOW_PATTERN = /^(\d+)(s|m|h|d)$/;

function parseWindow(value: string): number {
  const match = WINDOW_PATTERN.exec(value.trim());
  if (!match) {
    throw new PluginError({
      code: 'PLUGIN_RATE_LIMIT_WINDOW_INVALID',
      message: 'Rate limit window must use a format like "1m", "30s", "1h", or "1d".',
      statusCode: 400,
    });
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === 's' ? 1000 : unit === 'm' ? 60000 : unit === 'h' ? 3600000 : 86400000;
  return amount * multiplier;
}

function normalizePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new PluginError({
      code: 'PLUGIN_RATE_LIMIT_INPUT_INVALID',
      message: `${label} must be a positive integer.`,
      statusCode: 400,
    });
  }
  return value;
}

function windowKey(now: Date, windowMs: number): { key: string; resetAt: Date } {
  const start = Math.floor(now.getTime() / windowMs) * windowMs;
  return {
    key: String(start),
    resetAt: new Date(start + windowMs),
  };
}

function toResult(row: PluginRateLimitBucket): PluginRateLimitCheckResult {
  const remaining = Math.max(row.limit - row.count, 0);
  return {
    allowed: row.count <= row.limit,
    remaining,
    resetAt: row.resetAt,
    retryAfterSeconds:
      row.count > row.limit
        ? Math.max(1, Math.ceil((row.resetAt.getTime() - Date.now()) / 1000))
        : undefined,
  };
}

export class DbPluginRateLimitRepository implements PluginRateLimitRepository {
  constructor(private readonly executor: Executor = db) {}

  private async inSystem<T>(fn: (executor: Executor) => Promise<T>): Promise<T> {
    if (this.executor !== db) return fn(this.executor);
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', 'system', true)`);
      return fn(tx);
    });
  }

  async check(
    scope: PluginRateLimitScope,
    input: { bucket: string; limit: number; windowMs: number; cost: number; now: Date }
  ) {
    const window = windowKey(input.now, input.windowMs);
    return this.inSystem(async (executor) => {
      const [row] = await executor
        .insert(pluginRateLimitBuckets)
        .values({
          id: randomUUID(),
          pluginId: scope.pluginId,
          bucket: input.bucket,
          windowKey: window.key,
          count: input.cost,
          limit: input.limit,
          resetAt: window.resetAt,
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: [
            pluginRateLimitBuckets.pluginId,
            pluginRateLimitBuckets.bucket,
            pluginRateLimitBuckets.windowKey,
          ],
          set: {
            count: sql`${pluginRateLimitBuckets.count} + ${input.cost}`,
            limit: input.limit,
            resetAt: window.resetAt,
            updatedAt: input.now,
          },
        })
        .returning();

      return toResult(row);
    });
  }
}

export function createPluginRateLimitCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginRateLimitOptions = {}
): PluginRateLimit {
  const repository = options.repository ?? new DbPluginRateLimitRepository();

  function expandRuntimeBucket(bucket: string): string {
    return bucket
      .replace('{apiKeyId}', currentApiKeyId(scope) ?? 'anonymous')
      .replace('{route}', new URL(scope.request.url).pathname)
      .replace('{pluginId}', scope.contract.id);
  }

  return {
    async check(input) {
      enforceCapabilityPermission(scope, Permission.RateLimitCheck, 'ctx.rateLimit.check');
      const bucket = expandRuntimeBucket(input.bucket);
      assertPluginNamespaced(scope, bucket, 'Rate limit bucket');
      const result = await repository.check(
        { pluginId: scope.contract.id },
        {
          bucket,
          limit: normalizePositiveInteger(input.limit, 'Rate limit'),
          windowMs: parseWindow(input.window),
          cost: normalizePositiveInteger(input.cost ?? 1, 'Rate limit cost'),
          now: new Date(),
        }
      );

      if (!result.allowed) {
        throw new PluginError({
          code: 'PLUGIN_RATE_LIMITED',
          message: `Rate limit exceeded for "${input.bucket}".`,
          statusCode: 429,
          details: { ...result },
        });
      }

      return result;
    },
  };
}
