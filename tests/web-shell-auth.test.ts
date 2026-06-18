import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostRequest } from '../apps/host-next/lib/paths';
import {
  createHostSessionCookie,
  readHostSessionCookie,
} from '../apps/host-next/lib/auth';
import { POST as registerUserApi } from '../apps/host-next/app/api/auth/register/route';
import {
  passwordResetResponseData,
  POST as requestPasswordResetApi,
} from '../apps/host-next/app/api/auth/password-reset/request/route';

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

test('X9 auth session cookies require explicit production secret but allow dev fallback', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAuthSecret = process.env.PLOYKIT_AUTH_SECRET;
  const previousMediaSecret = process.env.PLOYKIT_MEDIA_SECRET;
  const previousSecretRef = process.env.PLOYKIT_AUTH_SECRET_REF;
  const previousKeyRefs = process.env.PLOYKIT_AUTH_KEY_REFS;
  const previousVerifyRefs = process.env.PLOYKIT_AUTH_VERIFY_SECRET_REFS;
  const previousKeyId = process.env.PLOYKIT_AUTH_KEY_ID;

  try {
    Reflect.set(process.env, 'NODE_ENV', 'production');
    delete process.env.PLOYKIT_AUTH_SECRET;
    delete process.env.PLOYKIT_MEDIA_SECRET;
    delete process.env.PLOYKIT_AUTH_SECRET_REF;
    delete process.env.PLOYKIT_AUTH_KEY_REFS;
    delete process.env.PLOYKIT_AUTH_VERIFY_SECRET_REFS;
    delete process.env.PLOYKIT_AUTH_KEY_ID;
    assert.throws(() => createHostSessionCookie('demo-admin'), /PLOYKIT_AUTH_KEY_RING_REQUIRED/);

    Reflect.set(process.env, 'NODE_ENV', 'development');
    const cookie = createHostSessionCookie('demo-admin');
    assert.match(cookie, /^ploykit_session=/);
    assert.equal(cookie.includes('Secure'), false);
  } finally {
    restoreEnv('NODE_ENV', previousNodeEnv);
    restoreEnv('PLOYKIT_AUTH_SECRET', previousAuthSecret);
    restoreEnv('PLOYKIT_MEDIA_SECRET', previousMediaSecret);
    restoreEnv('PLOYKIT_AUTH_SECRET_REF', previousSecretRef);
    restoreEnv('PLOYKIT_AUTH_KEY_REFS', previousKeyRefs);
    restoreEnv('PLOYKIT_AUTH_VERIFY_SECRET_REFS', previousVerifyRefs);
    restoreEnv('PLOYKIT_AUTH_KEY_ID', previousKeyId);
  }
});

test('X9 auth session cookies include kid and verify rotated key refs', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSecret = process.env.PLOYKIT_AUTH_TEST_SECRET;
  const previousNextSecret = process.env.PLOYKIT_AUTH_TEST_SECRET_NEXT;
  const previousKeyRefs = process.env.PLOYKIT_AUTH_KEY_REFS;
  const previousSecretRef = process.env.PLOYKIT_AUTH_SECRET_REF;
  const previousVerifyRefs = process.env.PLOYKIT_AUTH_VERIFY_SECRET_REFS;

  try {
    Reflect.set(process.env, 'NODE_ENV', 'production');
    process.env.PLOYKIT_AUTH_TEST_SECRET = 'test-current-secret';
    process.env.PLOYKIT_AUTH_KEY_REFS = 'current=env:PLOYKIT_AUTH_TEST_SECRET';
    delete process.env.PLOYKIT_AUTH_SECRET_REF;
    delete process.env.PLOYKIT_AUTH_VERIFY_SECRET_REFS;
    const cookie = createHostSessionCookie('demo-admin');
    assert.match(decodeURIComponent(cookie), /^ploykit_session=v3\.current\./);
    assert.equal(readHostSessionCookie(cookie)?.userId, 'demo-admin');

    process.env.PLOYKIT_AUTH_TEST_SECRET_NEXT = 'test-next-secret';
    process.env.PLOYKIT_AUTH_KEY_REFS = 'next=env:PLOYKIT_AUTH_TEST_SECRET_NEXT';
    process.env.PLOYKIT_AUTH_VERIFY_SECRET_REFS = 'current=env:PLOYKIT_AUTH_TEST_SECRET';
    assert.equal(readHostSessionCookie(cookie)?.userId, 'demo-admin');
    assert.match(decodeURIComponent(createHostSessionCookie('demo-admin')), /^ploykit_session=v3\.next\./);
  } finally {
    restoreEnv('NODE_ENV', previousNodeEnv);
    restoreEnv('PLOYKIT_AUTH_TEST_SECRET', previousSecret);
    restoreEnv('PLOYKIT_AUTH_TEST_SECRET_NEXT', previousNextSecret);
    restoreEnv('PLOYKIT_AUTH_KEY_REFS', previousKeyRefs);
    restoreEnv('PLOYKIT_AUTH_SECRET_REF', previousSecretRef);
    restoreEnv('PLOYKIT_AUTH_VERIFY_SECRET_REFS', previousVerifyRefs);
  }
});

test('X9 auth transactional routes use the host email provider contract', async () => {
  const previousProvider = process.env.PLOYKIT_EMAIL_PROVIDER;
  const previousWebhookUrl = process.env.PLOYKIT_EMAIL_WEBHOOK_URL;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAuthSecret = process.env.PLOYKIT_AUTH_SECRET;
  const previousFetch = globalThis.fetch;
  const sentSubjects: string[] = [];

  process.env.PLOYKIT_EMAIL_PROVIDER = 'webhook';
  process.env.PLOYKIT_EMAIL_WEBHOOK_URL = 'https://mail.example/send';
  globalThis.fetch = (async (_input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as { subject?: string };
    sentSubjects.push(payload.subject ?? '');
    return new Response('{}', { status: 202 });
  }) as typeof fetch;

  try {
    const email = `route-email-${Date.now()}@example.com`;
    const registerResponse = await registerUserApi(
      createHostRequest('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'RouteEmail@123', displayName: 'Route Email' }),
      })
    );
    assert.equal(registerResponse.status, 200);

    const resetResponse = await requestPasswordResetApi(
      createHostRequest('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    );
    assert.equal(resetResponse.status, 200);
    assert.deepEqual(sentSubjects, ['Verify your PloyKit account', 'Reset your PloyKit password']);

    const unknownResetResponse = await requestPasswordResetApi(
      createHostRequest('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `missing-${Date.now()}@example.com` }),
      })
    );
    const unknownResetBody = (await unknownResetResponse.json()) as {
      ok: boolean;
      data: { sent: boolean; resetToken?: string };
    };
    assert.equal(unknownResetResponse.status, 200);
    assert.equal(unknownResetBody.data.sent, true);
    assert.deepEqual(sentSubjects, ['Verify your PloyKit account', 'Reset your PloyKit password']);

    assert.deepEqual(
      passwordResetResponseData({ sent: true, resetToken: 'route-reset-token' }, 'production'),
      { sent: true }
    );
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv('NODE_ENV', previousNodeEnv);
    restoreEnv('PLOYKIT_AUTH_SECRET', previousAuthSecret);
    restoreEnv('PLOYKIT_EMAIL_PROVIDER', previousProvider);
    restoreEnv('PLOYKIT_EMAIL_WEBHOOK_URL', previousWebhookUrl);
  }
});
