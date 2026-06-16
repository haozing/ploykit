import assert from 'node:assert/strict';
import test from 'node:test';
import {
  drainHostEmailOutbox,
  enqueueHostEmail,
  getHostEmailProviderStatus,
  sendHostEmail,
} from '../apps/host-next/lib/email-provider';
import { getHostRuntime } from '../apps/host-next/lib/create-host';
import { DEFAULT_HOST_PRODUCT_ID } from '../apps/host-next/lib/default-scope';

test('X9 host email provider supports signed webhook adapter contract', async () => {
  const status = getHostEmailProviderStatus({
    PLOYKIT_EMAIL_PROVIDER: 'webhook',
    PLOYKIT_EMAIL_WEBHOOK_URL: 'https://mail.example/send',
    PLOYKIT_EMAIL_WEBHOOK_SECRET: 'secret',
  });
  assert.equal(status.mode, 'webhook');
  assert.equal(status.webhookConfigured, true);
  assert.equal(status.webhookSecretConfigured, true);

  let requestBody = '';
  let signature = '';
  const correlationId = `email-webhook-success-${Date.now()}`;
  const result = await sendHostEmail(
    {
      to: 'user@example.com',
      subject: 'Welcome',
      text: 'Hello from PloyKit',
      metadata: { notificationId: 'notification-1' },
      correlationId,
    },
    {
      env: {
        PLOYKIT_EMAIL_PROVIDER: 'webhook',
        PLOYKIT_EMAIL_WEBHOOK_URL: 'https://mail.example/send',
        PLOYKIT_EMAIL_WEBHOOK_SECRET: 'secret',
      },
      fetch: async (_input, init) => {
        requestBody = String(init?.body ?? '');
        signature = String((init?.headers as Record<string, string>)['x-ploykit-email-signature']);
        return new Response('{}', {
          status: 202,
          headers: { 'x-ploykit-provider-ref': 'msg_1' },
        });
      },
    }
  );
  const hostRuntime = await getHostRuntime();
  const invocations = await hostRuntime.runtimeStore.store.listProviderInvocations({
    productId: DEFAULT_HOST_PRODUCT_ID,
    providerId: 'email-webhook',
    kind: 'email',
    operation: 'send',
  });

  assert.equal(result.status, 'delivered');
  assert.equal(result.provider, 'email-webhook');
  assert.equal(result.providerRef, 'msg_1');
  assert.match(requestBody, /user@example.com/);
  assert.equal(signature.length, 64);
  assert.ok(
    invocations.some(
      (record) =>
        record.correlationId === correlationId &&
        record.status === 'succeeded' &&
        record.metadata.providerRef === 'msg_1'
    )
  );
});

test('K7 host email webhook retries retryable failures and records attempts', async () => {
  let attempts = 0;
  const result = await sendHostEmail(
    {
      to: 'retry@example.com',
      subject: 'Retry',
      text: 'Retry delivery',
    },
    {
      env: {
        PLOYKIT_EMAIL_PROVIDER: 'webhook',
        PLOYKIT_EMAIL_WEBHOOK_URL: 'https://mail.example/retry',
        PLOYKIT_EMAIL_WEBHOOK_SECRET: 'secret',
        PLOYKIT_EMAIL_RETRY_ATTEMPTS: '2',
        PLOYKIT_EMAIL_RETRY_BACKOFF_MS: '0',
      },
      fetch: async () => {
        attempts += 1;
        return new Response('{}', {
          status: attempts === 1 ? 503 : 202,
          headers: attempts === 2 ? { 'x-ploykit-provider-ref': 'msg_retry' } : undefined,
        });
      },
    }
  );
  const metadata = result.metadata as { attempts?: number } | undefined;

  assert.equal(attempts, 2);
  assert.equal(result.status, 'delivered');
  assert.equal(result.providerRef, 'msg_retry');
  assert.equal(metadata?.attempts, 2);
});

test('K7 host email webhook failures are visible in provider invocation evidence', async () => {
  const correlationId = `email-webhook-failure-${Date.now()}`;
  const result = await sendHostEmail(
    {
      to: 'failure@example.com',
      subject: 'Failure',
      text: 'Failure delivery',
      correlationId,
    },
    {
      env: {
        PLOYKIT_EMAIL_PROVIDER: 'webhook',
        PLOYKIT_EMAIL_WEBHOOK_URL: 'https://mail.example/failure',
        PLOYKIT_EMAIL_WEBHOOK_SECRET: 'secret',
        PLOYKIT_EMAIL_RETRY_ATTEMPTS: '1',
        PLOYKIT_EMAIL_RETRY_BACKOFF_MS: '0',
      },
      fetch: async () => new Response('{}', { status: 503 }),
    }
  );
  const hostRuntime = await getHostRuntime();
  const invocations = await hostRuntime.runtimeStore.store.listProviderInvocations({
    productId: DEFAULT_HOST_PRODUCT_ID,
    providerId: 'email-webhook',
    kind: 'email',
    operation: 'send',
    status: 'failed',
  });
  const invocation = invocations.find((record) => record.correlationId === correlationId);

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'webhook_status_503');
  assert.equal(invocation?.error?.code, 'webhook_status_503');
  assert.equal(invocation?.metadata.deliveryStatus, 'failed');
});

test('P6 host email outbox worker sends queued email and records delivery ledger', async () => {
  const hostRuntime = await getHostRuntime();
  const emailId = `email-outbox-${Date.now()}`;
  const queued = await enqueueHostEmail(
    {
      to: 'queued@example.com',
      subject: 'Queued delivery',
      text: 'Queued email body',
      emailId,
      correlationId: `corr-${emailId}`,
    },
    {
      idempotencyKey: emailId,
      maxAttempts: 2,
    }
  );
  const result = await drainHostEmailOutbox({
    leaseOwner: 'email-worker-test',
    env: {
      PLOYKIT_EMAIL_PROVIDER: 'log',
    },
  });
  const deliveries = await hostRuntime.runtimeStore.store.listDeliveries({
    productId: DEFAULT_HOST_PRODUCT_ID,
    kind: 'email',
    emailId,
  });

  assert.equal(result.processed, 1);
  assert.equal(result.records[0]?.id, queued.id);
  assert.equal(result.records[0]?.status, 'processed');
  assert.equal(
    deliveries.some((delivery) => delivery.outboxId === queued.id),
    true
  );
  assert.equal(deliveries[0]?.status, 'delivered');
});
