import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostRequest } from '../apps/host-next/lib/paths';
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
