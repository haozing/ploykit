import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ModuleDataPostgresExecutor,
  ModuleDataPostgresQueryResult,
} from '../src/lib/module-runtime/data';
import { createPostgresSlidingWindowRateLimiter } from '../src/lib/module-runtime/security/rate-limit';

interface FakeRateLimitEvent {
  bucket: string;
  cost: number;
  occurredAt: number;
}

function createFakePostgresRateLimitExecutor(): {
  database: ModuleDataPostgresExecutor;
  events: FakeRateLimitEvent[];
} {
  const events: FakeRateLimitEvent[] = [];
  function result<TRecord>(rows: TRecord[]): ModuleDataPostgresQueryResult<TRecord> {
    return { rows };
  }
  const database: ModuleDataPostgresExecutor = {
    async transaction(callback) {
      return callback(database);
    },
    async query<TRecord = Record<string, unknown>>(text: string, values: readonly unknown[] = []) {
      const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
      if (sql.startsWith('select pg_advisory_xact_lock')) {
        return result<TRecord>([]);
      }
      if (sql === 'delete from module_rate_limit_events where bucket = $1') {
        const bucket = String(values[0]);
        for (let index = events.length - 1; index >= 0; index -= 1) {
          if (events[index]!.bucket === bucket) {
            events.splice(index, 1);
          }
        }
        return result<TRecord>([]);
      }
      if (sql.startsWith('delete from module_rate_limit_events where bucket')) {
        const bucket = String(values[0]);
        const windowStart = new Date(String(values[1])).getTime();
        for (let index = events.length - 1; index >= 0; index -= 1) {
          if (events[index]!.bucket === bucket && events[index]!.occurredAt <= windowStart) {
            events.splice(index, 1);
          }
        }
        return result<TRecord>([]);
      }
      if (sql.startsWith('delete from module_rate_limit_events')) {
        for (let index = events.length - 1; index >= 0; index -= 1) {
          events.splice(index, 1);
        }
        return result<TRecord>([]);
      }
      if (sql.startsWith('select coalesce(sum(cost)')) {
        const bucket = String(values[0]);
        const windowStart = new Date(String(values[1])).getTime();
        const total = events
          .filter((event) => event.bucket === bucket && event.occurredAt > windowStart)
          .reduce((sum, event) => sum + event.cost, 0);
        return result<TRecord>([{ total } as TRecord]);
      }
      if (sql.startsWith('insert into module_rate_limit_events')) {
        events.push({
          bucket: String(values[0]),
          cost: Number(values[1]),
          occurredAt: new Date(String(values[2])).getTime(),
        });
        return result<TRecord>([]);
      }
      if (sql.startsWith('select min(occurred_at)')) {
        const bucket = String(values[0]);
        const windowStart = new Date(String(values[1])).getTime();
        const times = events
          .filter((event) => event.bucket === bucket && event.occurredAt > windowStart)
          .map((event) => event.occurredAt);
        const occurredAt = times.length > 0 ? new Date(Math.min(...times)).toISOString() : null;
        return result<TRecord>([{ occurred_at: occurredAt } as TRecord]);
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };
  return { database, events };
}

test('Postgres sliding-window rate limiter shares bucket state and expires old events', async () => {
  const fake = createFakePostgresRateLimitExecutor();
  let timestamp = new Date('2026-05-19T10:00:00.000Z').getTime();
  const limiter = createPostgresSlidingWindowRateLimiter({
    database: fake.database,
    now: () => new Date(timestamp),
  });
  const input = {
    bucket: 'login:product-a:anonymous:203.0.113.0/24',
    rule: { limit: 2, windowMs: 60_000 },
  };

  assert.deepEqual(await limiter.check(input), {
    ok: true,
    remaining: 1,
    resetAt: '2026-05-19T10:01:00.000Z',
  });
  assert.deepEqual(await limiter.check(input), {
    ok: true,
    remaining: 0,
    resetAt: '2026-05-19T10:01:00.000Z',
  });
  assert.deepEqual(await limiter.check(input), {
    ok: false,
    remaining: 0,
    resetAt: '2026-05-19T10:01:00.000Z',
  });

  timestamp = new Date('2026-05-19T10:01:01.000Z').getTime();
  const afterWindow = await limiter.check(input);
  assert.equal(afterWindow.ok, true);
  assert.equal(afterWindow.remaining, 1);
  assert.equal(fake.events.length, 1);

  await limiter.reset?.(input.bucket);
  assert.equal(fake.events.length, 0);
});
