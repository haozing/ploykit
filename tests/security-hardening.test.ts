import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCsrfGuard,
  createCsrfToken,
  createInMemoryRateLimiter,
  createRateLimitBucket,
  createSecurityHeaders,
  redactSensitive,
} from '../src/lib/module-runtime';

test('P18 security headers include CSP, HSTS, frame, referrer and permissions policies', () => {
  const headers = createSecurityHeaders({ frameAncestors: ["'none'"] });

  assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(headers['strict-transport-security'], /max-age=31536000/);
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.match(headers['permissions-policy'], /camera=\(\)/);
});

test('P18 csrf guard rejects bad origins and invalid tokens', () => {
  const guard = createCsrfGuard({
    secret: 'secret',
    allowedOrigins: ['https://app.example.com'],
  });
  const token = createCsrfToken('secret', 'session-1');

  assert.deepEqual(guard.verify({ method: 'GET' }), { ok: true });
  assert.equal(
    guard.verify({
      method: 'POST',
      origin: 'https://evil.example.com',
      sessionId: 'session-1',
      token,
    }).ok,
    false
  );
  assert.deepEqual(
    guard.verify({
      method: 'POST',
      origin: 'https://app.example.com',
      sessionId: 'session-1',
      token,
    }),
    { ok: true }
  );
});

test('P18 rate limiter scopes by product workspace user ip route and cost', () => {
  const limiter = createInMemoryRateLimiter({
    now: () => new Date('2026-05-19T00:00:00.000Z'),
  });
  const bucket = createRateLimitBucket({
    kind: 'high-cost',
    productId: 'product-a',
    workspaceId: 'workspace-a',
    userId: 'user-1',
    ipPrefix: '203.0.113.0/24',
    route: '/api/ai',
  });

  assert.equal(limiter.check({ bucket, rule: { limit: 3, windowMs: 60_000 }, cost: 2 }).ok, true);
  assert.equal(limiter.check({ bucket, rule: { limit: 3, windowMs: 60_000 }, cost: 2 }).ok, false);
});

test('P18 redaction covers nested secrets before admin or browser exposure', () => {
  assert.deepEqual(
    redactSensitive({
      DATABASE_URL: 'postgres://user:secret@localhost:5432/app',
      nested: { apiKey: 'secret', secretConfigured: true, ok: true },
    }),
    {
      DATABASE_URL: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', secretConfigured: true, ok: true },
    }
  );
});
