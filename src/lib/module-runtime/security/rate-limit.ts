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

interface BucketState {
  count: number;
  resetAt: number;
}

export function createInMemoryRateLimiter(options: { now?: () => Date } = {}): {
  check(input: RateLimitInput): RateLimitResult;
  reset(bucket?: string): void;
} {
  const now = options.now ?? (() => new Date());
  const buckets = new Map<string, BucketState>();

  return {
    check(input) {
      const timestamp = now().getTime();
      const cost = input.cost ?? 1;
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
