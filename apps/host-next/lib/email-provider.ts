import { createHmac } from 'node:crypto';
import type {
  RuntimeStoreDeliveryStatus,
  RuntimeStoreNotificationDeliveryStatus,
  RuntimeStoreOutboxRecord,
} from '@/lib/module-runtime';
import {
  createRuntimeStoreQueue,
  type RuntimeStoreQueueDrainResult,
  type RuntimeStoreQueueMessage,
} from '@/lib/module-runtime/queue/runtime-store-queue';
import { DEFAULT_HOST_PRODUCT_ID } from './default-scope';
import { readHostSettingsView } from './host-settings';
import { getHostRuntimeStore } from './runtime-store';

export type HostEmailProviderMode = 'disabled' | 'log' | 'webhook';

export interface HostEmailProviderConfig {
  mode: HostEmailProviderMode;
  configured: boolean;
  from: string;
  webhookUrl?: string;
  webhookSecretConfigured: boolean;
  retryAttempts: number;
  retryBackoffMs: number;
  timeoutMs: number;
}

export interface HostEmailProviderStatus {
  mode: HostEmailProviderMode;
  configured: boolean;
  from: string;
  webhookConfigured: boolean;
  webhookSecretConfigured: boolean;
  retry: {
    attempts: number;
    backoffMs: number;
    timeoutMs: number;
  };
}

export interface HostEmailMessage {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  metadata?: Record<string, unknown>;
  productId?: string;
  workspaceId?: string | null;
  moduleId?: string | null;
  actorId?: string | null;
  emailId?: string;
  correlationId?: string;
  causationId?: string;
}

export interface HostEmailDeliveryResult {
  provider: string;
  status: RuntimeStoreNotificationDeliveryStatus;
  reason?: string;
  providerRef?: string;
  metadata?: Record<string, unknown>;
}

export interface HostEmailOutboxPayload {
  message: HostEmailMessage;
  queuedAt: string;
}

type HostEmailEnv = Partial<
  Record<
    | 'PLOYKIT_EMAIL_PROVIDER'
    | 'PLOYKIT_EMAIL_FROM'
    | 'PLOYKIT_EMAIL_WEBHOOK_URL'
    | 'PLOYKIT_EMAIL_WEBHOOK_SECRET',
    string | undefined
  > &
    Record<
      | 'PLOYKIT_EMAIL_RETRY_ATTEMPTS'
      | 'PLOYKIT_EMAIL_RETRY_BACKOFF_MS'
      | 'PLOYKIT_EMAIL_TIMEOUT_MS',
      string | undefined
    >
>;

type EmailFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

function stringMetadata(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function boundedNumber(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function normalizeMode(value: string | undefined): HostEmailProviderMode {
  if (!value) {
    return 'log';
  }
  if (value === 'disabled' || value === 'log' || value === 'webhook') {
    return value;
  }
  throw new Error(
    `PLOYKIT_EMAIL_PROVIDER_INVALID: expected disabled, log or webhook, got ${value}`
  );
}

function signBody(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function resolveHostEmailProviderConfig(env: HostEmailEnv): HostEmailProviderConfig {
  const mode = normalizeMode(env.PLOYKIT_EMAIL_PROVIDER);
  const webhookUrl = env.PLOYKIT_EMAIL_WEBHOOK_URL?.trim();
  const webhookSecret = env.PLOYKIT_EMAIL_WEBHOOK_SECRET?.trim();
  const retryAttempts = boundedNumber(env.PLOYKIT_EMAIL_RETRY_ATTEMPTS, 3, 1, 6);
  return {
    mode,
    configured: mode === 'log' || mode === 'disabled' || Boolean(webhookUrl),
    from: env.PLOYKIT_EMAIL_FROM ?? 'PloyKit <no-reply@ploykit.local>',
    webhookUrl: webhookUrl || undefined,
    webhookSecretConfigured: Boolean(webhookSecret),
    retryAttempts,
    retryBackoffMs: boundedNumber(env.PLOYKIT_EMAIL_RETRY_BACKOFF_MS, 250, 0, 30_000),
    timeoutMs: boundedNumber(env.PLOYKIT_EMAIL_TIMEOUT_MS, 8000, 250, 120_000),
  };
}

export function getHostEmailProviderStatus(
  env: HostEmailEnv = process.env as HostEmailEnv
): HostEmailProviderStatus {
  const config = resolveHostEmailProviderConfig(env);
  return {
    mode: config.mode,
    configured: config.configured,
    from: config.from,
    webhookConfigured: Boolean(config.webhookUrl),
    webhookSecretConfigured: config.webhookSecretConfigured,
    retry: {
      attempts: config.retryAttempts,
      backoffMs: config.retryBackoffMs,
      timeoutMs: config.timeoutMs,
    },
  };
}

export async function getEffectiveHostEmailProviderStatus(
  env: HostEmailEnv = process.env as HostEmailEnv
): Promise<HostEmailProviderStatus> {
  const resolvedEnv = await resolveRuntimeEmailEnv(env);
  return getHostEmailProviderStatus(resolvedEnv);
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function fetchWithTimeout(
  fetchImpl: EmailFetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`email_webhook_timeout_${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveRuntimeEmailEnv(env: HostEmailEnv): Promise<HostEmailEnv> {
  try {
    const runtimeStore = await getHostRuntimeStore();
    const settings = await readHostSettingsView(runtimeStore.store, DEFAULT_HOST_PRODUCT_ID);
    const emailProvider = stringMetadata(settings.emailProvider);
    const fromEmail = stringMetadata(settings.fromEmail);
    const fromName = stringMetadata(settings.fromName);
    return {
      ...env,
      PLOYKIT_EMAIL_PROVIDER: env.PLOYKIT_EMAIL_PROVIDER ?? emailProvider,
      PLOYKIT_EMAIL_FROM:
        env.PLOYKIT_EMAIL_FROM ??
        (fromEmail ? `${fromName ?? 'PloyKit'} <${fromEmail}>` : undefined),
    };
  } catch {
    return env;
  }
}

function emailErrorCategory(result: HostEmailDeliveryResult): string | null {
  if (result.status !== 'failed') {
    return null;
  }
  return result.reason ?? 'email_delivery_failed';
}

function deliveryAttempts(result: HostEmailDeliveryResult): number {
  const attempts = result.metadata?.attempts;
  return typeof attempts === 'number' && Number.isFinite(attempts) ? attempts : 1;
}

function providerInvocationError(result: HostEmailDeliveryResult) {
  if (result.status !== 'failed') {
    return undefined;
  }
  return {
    code: result.reason ?? 'EMAIL_DELIVERY_FAILED',
    message: result.reason ?? 'Email delivery failed.',
  };
}

async function recordEmailProviderInvocation(
  message: HostEmailMessage,
  result: HostEmailDeliveryResult,
  options: {
    outboxId?: string | null;
    latencyMs?: number;
  } = {}
): Promise<void> {
  try {
    const runtimeStore = await getHostRuntimeStore();
    await runtimeStore.store.recordProviderInvocation({
      productId: message.productId ?? DEFAULT_HOST_PRODUCT_ID,
      workspaceId: message.workspaceId ?? null,
      moduleId: message.moduleId ?? null,
      providerId: result.provider,
      kind: 'email',
      operation: 'send',
      status: result.status === 'failed' ? 'failed' : 'succeeded',
      target: message.emailId ?? message.to,
      usage: {
        attempts: deliveryAttempts(result),
      },
      latencyMs: options.latencyMs,
      correlationId: message.correlationId ?? message.emailId ?? null,
      error: providerInvocationError(result),
      metadata: {
        emailId: message.emailId,
        outboxId: options.outboxId,
        deliveryStatus: result.status,
        subject: message.subject,
        providerRef: result.providerRef,
        reason: result.reason,
        ...(result.metadata ?? {}),
      },
    });
  } catch {
    // Email delivery must not fail because provider evidence could not be recorded.
  }
}

async function recordEmailDeliveryLedger(
  message: HostEmailMessage,
  result: HostEmailDeliveryResult,
  options: {
    outboxId?: string | null;
    status?: RuntimeStoreDeliveryStatus;
    attempts?: number;
    nextRetryAt?: string | null;
  } = {}
): Promise<void> {
  try {
    const runtimeStore = await getHostRuntimeStore();
    await runtimeStore.store.recordDelivery({
      productId: message.productId ?? DEFAULT_HOST_PRODUCT_ID,
      workspaceId: message.workspaceId ?? null,
      moduleId: message.moduleId ?? null,
      actorId: message.actorId ?? null,
      kind: 'email',
      source: result.provider,
      target: message.to,
      status: options.status ?? (result.status === 'delivered' ? 'delivered' : result.status),
      attempts: options.attempts ?? deliveryAttempts(result),
      outboxId: options.outboxId ?? null,
      emailId: message.emailId ?? null,
      correlationId: message.correlationId ?? null,
      causationId: message.causationId ?? null,
      nextRetryAt: options.nextRetryAt ?? null,
      errorCategory: emailErrorCategory(result),
      error:
        result.status === 'failed'
          ? { code: result.reason ?? 'EMAIL_DELIVERY_FAILED', message: result.reason ?? 'Email delivery failed.' }
          : undefined,
      metadata: {
        subject: message.subject,
        providerRef: result.providerRef,
        reason: result.reason,
        ...(result.metadata ?? {}),
      },
    });
  } catch {
    // Email delivery must not fail because operational evidence could not be recorded.
  }
}

async function deliverHostEmailNow(
  message: HostEmailMessage,
  options: {
    env?: HostEmailEnv;
    fetch?: EmailFetch;
  } = {}
): Promise<HostEmailDeliveryResult> {
  const env = options.env ?? (await resolveRuntimeEmailEnv(process.env as HostEmailEnv));
  const config = resolveHostEmailProviderConfig(env);
  let result: HostEmailDeliveryResult;
  if (config.mode === 'disabled') {
    result = {
      provider: 'email-disabled',
      status: 'skipped',
      reason: 'email_provider_disabled',
    };
    return result;
  }

  if (config.mode === 'log') {
    result = {
      provider: 'email-log',
      status: 'delivered',
      reason: 'logged_locally',
      metadata: { from: config.from, to: message.to, subject: message.subject },
    };
    return result;
  }

  if (!config.webhookUrl) {
    result = {
      provider: 'email-webhook',
      status: 'failed',
      reason: 'webhook_url_missing',
    };
    return result;
  }

  const body = JSON.stringify({
    from: config.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    metadata: message.metadata ?? {},
  });
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  const webhookSecret = env.PLOYKIT_EMAIL_WEBHOOK_SECRET?.trim();
  if (webhookSecret) {
    headers['x-ploykit-email-signature'] = signBody(body, webhookSecret);
  }

  const fetchImpl = options.fetch ?? fetch;
  let lastReason = 'webhook_send_failed';
  let lastProviderRef: string | undefined;
  for (let attempt = 1; attempt <= config.retryAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        fetchImpl,
        config.webhookUrl,
        {
          method: 'POST',
          headers,
          body,
        },
        config.timeoutMs
      );
      const providerRef = response.headers.get('x-ploykit-provider-ref') ?? undefined;
      lastProviderRef = providerRef;
      if (response.ok) {
        result = {
          provider: 'email-webhook',
          status: 'delivered',
          providerRef,
          metadata: {
            webhookUrl: config.webhookUrl,
            signed: Boolean(webhookSecret),
            attempts: attempt,
            retryBackoffMs: config.retryBackoffMs,
            timeoutMs: config.timeoutMs,
          },
        };
        return result;
      }
      lastReason = `webhook_status_${response.status}`;
      if (!retryableStatus(response.status) || attempt >= config.retryAttempts) {
        break;
      }
    } catch (error) {
      lastReason = error instanceof Error ? error.message : 'webhook_send_failed';
      if (attempt >= config.retryAttempts) {
        break;
      }
    }
    await sleep(config.retryBackoffMs * attempt);
  }
  result = {
    provider: 'email-webhook',
    status: 'failed',
    reason: lastReason,
    providerRef: lastProviderRef,
    metadata: {
      webhookUrl: config.webhookUrl,
      signed: Boolean(webhookSecret),
      attempts: config.retryAttempts,
      retryBackoffMs: config.retryBackoffMs,
      timeoutMs: config.timeoutMs,
    },
  };
  return result;
}

function maxAttemptsForEmailMessage(
  message: RuntimeStoreQueueMessage<HostEmailOutboxPayload>,
  override: number | undefined
): number {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return override;
  }
  const metadataMaxAttempts = message.metadata.maxAttempts;
  if (
    typeof metadataMaxAttempts === 'number' &&
    Number.isFinite(metadataMaxAttempts) &&
    metadataMaxAttempts > 0
  ) {
    return metadataMaxAttempts;
  }
  return 3;
}

function nextRetryAtForEmail(
  status: RuntimeStoreDeliveryStatus,
  retryBackoffMs: number | undefined
): string | null {
  if (
    status !== 'failed' ||
    typeof retryBackoffMs !== 'number' ||
    !Number.isFinite(retryBackoffMs) ||
    retryBackoffMs <= 0
  ) {
    return null;
  }
  return new Date(Date.now() + retryBackoffMs).toISOString();
}

function failedEmailDeliveryStatus(
  message: RuntimeStoreQueueMessage<HostEmailOutboxPayload>,
  maxAttempts: number | undefined
): RuntimeStoreDeliveryStatus {
  return message.attempts >= maxAttemptsForEmailMessage(message, maxAttempts)
    ? 'dead_letter'
    : 'failed';
}

export async function sendHostEmail(
  message: HostEmailMessage,
  options: {
    env?: HostEmailEnv;
    fetch?: EmailFetch;
  } = {}
): Promise<HostEmailDeliveryResult> {
  const startedAt = Date.now();
  const result = await deliverHostEmailNow(message, options);
  await recordEmailProviderInvocation(message, result, {
    latencyMs: Date.now() - startedAt,
  });
  await recordEmailDeliveryLedger(message, result);
  return result;
}

export async function enqueueHostEmail(
  message: HostEmailMessage,
  options: {
    idempotencyKey?: string;
    scheduledAt?: string;
    priority?: number;
    maxAttempts?: number;
  } = {}
): Promise<RuntimeStoreOutboxRecord<HostEmailOutboxPayload>> {
  const runtimeStore = await getHostRuntimeStore();
  const productId = message.productId ?? DEFAULT_HOST_PRODUCT_ID;
  const payload: HostEmailOutboxPayload = {
    message: {
      ...message,
      productId,
      workspaceId: message.workspaceId ?? null,
    },
    queuedAt: new Date().toISOString(),
  };
  return runtimeStore.store.enqueueOutbox({
    productId,
    workspaceId: message.workspaceId ?? null,
    moduleId: message.moduleId ?? null,
    actorId: message.actorId ?? null,
    name: 'email:send',
    payload,
    idempotencyKey:
      options.idempotencyKey ??
      (message.emailId ? `email:${productId}:${message.emailId}` : undefined),
    scheduledAt: options.scheduledAt,
    priority: options.priority,
    metadata: {
      maxAttempts: options.maxAttempts ?? 3,
      emailId: message.emailId,
      correlationId: message.correlationId,
      causationId: message.causationId,
      to: message.to,
      subject: message.subject,
    },
  });
}

export async function drainHostEmailOutbox(
  input: {
    productId?: string;
    workspaceId?: string | null;
    limit?: number;
    concurrency?: number;
    maxAttempts?: number;
    leaseOwner?: string;
    leaseMs?: number;
    retryBackoffMs?: number;
    env?: HostEmailEnv;
    fetch?: EmailFetch;
  } = {}
): Promise<RuntimeStoreQueueDrainResult> {
  const runtimeStore = await getHostRuntimeStore();
  const queue = createRuntimeStoreQueue({
    store: runtimeStore.store,
    productId: input.productId ?? DEFAULT_HOST_PRODUCT_ID,
    workspaceId: input.workspaceId ?? null,
  });

  return queue.drain<HostEmailOutboxPayload>({
    namePrefix: 'email:',
    limit: input.limit,
    concurrency: input.concurrency,
    maxAttempts: input.maxAttempts,
    leaseOwner: input.leaseOwner,
    leaseMs: input.leaseMs,
    retryBackoffMs: input.retryBackoffMs,
    handler: async (queueMessage) => {
      const message = queueMessage.payload.message;
      const startedAt = Date.now();
      const result = await deliverHostEmailNow(message, {
        env: input.env,
        fetch: input.fetch,
      });
      await recordEmailProviderInvocation(message, result, {
        outboxId: queueMessage.id,
        latencyMs: Date.now() - startedAt,
      });
      if (result.status === 'failed') {
        const status = failedEmailDeliveryStatus(queueMessage, input.maxAttempts);
        await recordEmailDeliveryLedger(message, result, {
          outboxId: queueMessage.id,
          status,
          attempts: queueMessage.attempts,
          nextRetryAt: nextRetryAtForEmail(status, input.retryBackoffMs),
        });
        throw new Error(result.reason ?? 'EMAIL_DELIVERY_FAILED');
      }
      await recordEmailDeliveryLedger(message, result, {
        outboxId: queueMessage.id,
        status: result.status === 'delivered' ? 'delivered' : result.status,
        attempts: queueMessage.attempts,
      });
    },
  });
}
