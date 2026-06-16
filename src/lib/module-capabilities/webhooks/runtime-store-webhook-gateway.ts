import { createHash } from 'node:crypto';
import { Permission, type ModuleContext, type ModuleWebhookDefinition } from '@ploykit/module-sdk';
import { readModuleDefaultExport } from '../../module-runtime/adapters';
import {
  createModuleBackgroundContext,
  type ModuleBackgroundContextCapabilities,
} from '../../module-runtime/context';
import type { ModuleRuntimeHost } from '../../module-runtime/host';
import type { RuntimeStore, RuntimeStoreWebhookReceipt } from '../../module-runtime/stores';
import { redactSensitive } from '../../module-runtime/observability/redaction';
import {
  createRuntimeStoreQueue,
  type RuntimeStoreQueue,
  type RuntimeStoreQueueDrainResult,
} from '../../module-runtime/queue';
import {
  githubWebhookSignatureProvider,
  hmacSha256WebhookSignatureProvider,
  noneWebhookSignatureProvider,
  stripeWebhookSignatureProvider,
  type WebhookSignatureProvider,
} from './signature-providers';

export type RuntimeWebhookSecretResolver = (input: {
  moduleId: string;
  webhookName: string;
}) => string | null | undefined | Promise<string | null | undefined>;

export interface RuntimeStoreWebhookGateway {
  queue: RuntimeStoreQueue;
  receive(input: {
    moduleId: string;
    webhookName: string;
    path: string;
    method: string;
    bodyText: string;
    idempotencyKey?: string;
    signature?: string;
    headers?: Record<string, string>;
    signatureProvider?: string;
    maxAttempts?: number;
  }): Promise<{ duplicate: boolean; receipt: RuntimeStoreWebhookReceipt }>;
  replay(receiptId: string): Promise<RuntimeStoreWebhookReceipt>;
}

export interface RuntimeStoreWebhookEvent<TBody = unknown> {
  request: Request;
  receipt: RuntimeStoreWebhookReceipt;
  bodyText: string;
  json<T = TBody>(): Promise<T>;
}

export type RuntimeStoreWebhookHandler<TBody = unknown> = (
  ctx: ModuleContext,
  event: RuntimeStoreWebhookEvent<TBody>
) => Response | unknown | Promise<Response | unknown>;

export interface RuntimeStoreWebhookRunner {
  queue: RuntimeStoreQueue;
  drain(input?: {
    limit?: number;
    concurrency?: number;
    maxAttempts?: number;
    leaseOwner?: string;
    leaseMs?: number;
    retryBackoffMs?: number;
  }): Promise<RuntimeStoreQueueDrainResult>;
}

export interface CreateRuntimeStoreWebhookGatewayOptions {
  store: RuntimeStore;
  productId: string;
  workspaceId?: string | null;
  secretResolver?: RuntimeWebhookSecretResolver;
  signatureProviders?: Record<string, WebhookSignatureProvider>;
}

export interface CreateRuntimeStoreWebhookRunnerOptions {
  store: RuntimeStore;
  productId: string;
  workspaceId?: string | null;
  session?: import('../../module-runtime/security').ModuleRuntimeAccessSession;
  capabilities?: ModuleBackgroundContextCapabilities;
}

interface RuntimeStoreWebhookOutboxPayload {
  receiptId: string;
  moduleId: string;
  webhookName: string;
  path?: string;
  method?: string;
  bodyText?: string;
  bodyDigest?: string;
  headers?: Record<string, string>;
  replay?: boolean;
}

function bodyDigest(bodyText: string): string {
  return `sha256:${createHash('sha256').update(bodyText).digest('hex')}`;
}

function normalizeModulePath(value: string): string {
  return value.replace(/^\.\//, '');
}

function asWebhookHandler(value: unknown): RuntimeStoreWebhookHandler | null {
  const exported = readModuleDefaultExport(value);
  if (typeof exported === 'function') {
    return exported as RuntimeStoreWebhookHandler;
  }
  if (exported && typeof exported === 'object' && 'handle' in exported) {
    const handle = (exported as { handle?: unknown }).handle;
    return typeof handle === 'function' ? (handle as RuntimeStoreWebhookHandler) : null;
  }
  return null;
}

function findWebhookDefinition(
  host: ModuleRuntimeHost,
  moduleId: string,
  webhookName: string
): ModuleWebhookDefinition | null {
  return host.getContract(moduleId)?.webhooks[webhookName] ?? null;
}

function createWebhookRequest(input: {
  path: string;
  method: string;
  bodyText: string;
  headers?: Record<string, string>;
}): Request {
  return new Request(`http://localhost${input.path}`, {
    method: input.method,
    headers: input.headers,
    body: ['GET', 'HEAD'].includes(input.method.toUpperCase()) ? undefined : input.bodyText,
  });
}

function normalizeWebhookHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> {
  return redactSensitive(
    Object.fromEntries(
      Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)])
    )
  );
}

function replayHeaders(receipt: RuntimeStoreWebhookReceipt): Record<string, string> {
  const headers = { ...(receipt.headers ?? {}) };
  if (receipt.signature && !headers['x-ploykit-signature']) {
    headers['x-ploykit-signature'] = receipt.signature;
  }
  return headers;
}

export function createRuntimeStoreWebhookGateway(
  options: CreateRuntimeStoreWebhookGatewayOptions
): RuntimeStoreWebhookGateway {
  const queue = createRuntimeStoreQueue({
    store: options.store,
    productId: options.productId,
    workspaceId: options.workspaceId,
  });
  const providers: Record<string, WebhookSignatureProvider> = {
    none: noneWebhookSignatureProvider,
    'hmac-sha256': hmacSha256WebhookSignatureProvider,
    github: githubWebhookSignatureProvider,
    stripe: stripeWebhookSignatureProvider,
    ...(options.signatureProviders ?? {}),
  };

  return {
    queue,
    async receive(input) {
      const existing = input.idempotencyKey
        ? await options.store.findWebhookReceiptByIdempotencyKey(
            options.productId,
            options.workspaceId,
            input.moduleId,
            input.webhookName,
            input.idempotencyKey
          )
        : null;
      if (existing && existing.status !== 'rejected') {
        const receipt = await options.store.markWebhookReceipt(existing.id, 'duplicate');
        return { duplicate: true, receipt };
      }

      const receipt =
        existing?.status === 'rejected'
          ? await options.store.markWebhookReceipt(existing.id, 'received')
          : (existing ??
            (await options.store.createWebhookReceipt({
              productId: options.productId,
              workspaceId: options.workspaceId,
              moduleId: input.moduleId,
              webhookName: input.webhookName,
              path: input.path,
              method: input.method,
              idempotencyKey: input.idempotencyKey,
              signature: input.signature,
              headers: normalizeWebhookHeaders(input.headers),
              bodyText: input.bodyText,
              bodyDigest: bodyDigest(input.bodyText),
            })));

      const providerName = input.signatureProvider ?? 'none';
      const provider = providers[providerName];
      const secret = providerName === 'none' ? '' : await options.secretResolver?.(input);
      if (!provider) {
        return {
          duplicate: false,
          receipt: await options.store.markWebhookReceipt(
            receipt.id,
            'rejected',
            `Webhook signature provider "${providerName}" is not supported.`
          ),
        };
      }
      if (providerName !== 'none' && !secret) {
        return {
          duplicate: false,
          receipt: await options.store.markWebhookReceipt(
            receipt.id,
            'rejected',
            'Webhook secret is not configured.'
          ),
        };
      }
      if (
        !provider.verify({
          bodyText: input.bodyText,
          signature: input.signature,
          secret: secret ?? '',
        })
      ) {
        return {
          duplicate: false,
          receipt: await options.store.markWebhookReceipt(
            receipt.id,
            'rejected',
            'Webhook signature rejected.'
          ),
        };
      }

      await options.store.enqueueOutbox({
        productId: options.productId,
        workspaceId: options.workspaceId,
        moduleId: input.moduleId,
        name: `webhook:${input.moduleId}:${input.webhookName}`,
        idempotencyKey: input.idempotencyKey
          ? `webhook:${input.moduleId}:${input.webhookName}:${input.idempotencyKey}`
          : undefined,
        payload: {
          receiptId: receipt.id,
          moduleId: input.moduleId,
          webhookName: input.webhookName,
          path: input.path,
          method: input.method,
          bodyText: input.bodyText,
          bodyDigest: bodyDigest(input.bodyText),
          headers: normalizeWebhookHeaders(input.headers),
        },
        metadata: {
          maxAttempts: input.maxAttempts ?? 3,
        },
      });
      return {
        duplicate: false,
        receipt:
          (
            await options.store.listWebhookReceipts({
              productId: options.productId,
              moduleId: input.moduleId,
            })
          ).find((candidate) => candidate.id === receipt.id) ?? receipt,
      };
    },
    async replay(receiptId) {
      const receipt = (
        await options.store.listWebhookReceipts({ productId: options.productId })
      ).find((candidate) => candidate.id === receiptId);
      if (!receipt) {
        throw new Error(`MODULE_WEBHOOK_RECEIPT_NOT_FOUND: ${receiptId}`);
      }
      const replayed = await options.store.markWebhookReceipt(receipt.id, 'received');
      await options.store.enqueueOutbox({
        productId: options.productId,
        workspaceId: options.workspaceId,
        moduleId: receipt.moduleId,
        name: `webhook:${receipt.moduleId}:${receipt.webhookName}`,
        idempotencyKey: `webhook-replay:${receipt.id}:${Date.now()}`,
        payload: {
          receiptId: receipt.id,
          moduleId: receipt.moduleId,
          webhookName: receipt.webhookName,
          path: receipt.path,
          method: receipt.method,
          bodyText: receipt.bodyText,
          bodyDigest: receipt.bodyDigest,
          headers: replayHeaders(receipt),
          replay: true,
        },
        metadata: {
          maxAttempts: 3,
        },
      });
      return replayed;
    },
  };
}

export function createRuntimeStoreWebhookRunner(
  host: ModuleRuntimeHost,
  options: CreateRuntimeStoreWebhookRunnerOptions
): RuntimeStoreWebhookRunner {
  const queue = createRuntimeStoreQueue({
    store: options.store,
    productId: options.productId,
    workspaceId: options.workspaceId,
  });

  return {
    queue,
    drain(input = {}) {
      return queue.drain<RuntimeStoreWebhookOutboxPayload>({
        namePrefix: 'webhook:',
        limit: input.limit,
        concurrency: input.concurrency,
        maxAttempts: input.maxAttempts,
        leaseOwner: input.leaseOwner,
        leaseMs: input.leaseMs,
        retryBackoffMs: input.retryBackoffMs,
        handler: async (message) => {
          const payload = message.payload;
          const definition = findWebhookDefinition(host, payload.moduleId, payload.webhookName);
          const contract = host.getContract(payload.moduleId);
          if (!contract || !definition) {
            throw new Error(`MODULE_WEBHOOK_NOT_FOUND: ${payload.moduleId}.${payload.webhookName}`);
          }
          if (!contract.permissions.includes(Permission.WebhookReceive)) {
            throw new Error(`MODULE_WEBHOOK_PERMISSION_NOT_DECLARED: ${contract.id}`);
          }

          const entry = host.getMapEntry(contract.id);
          const loader = entry?.webhooks?.[normalizeModulePath(definition.handler)];
          if (!loader) {
            throw new Error(`MODULE_WEBHOOK_HANDLER_MISSING: ${definition.handler}`);
          }
          const handler = asWebhookHandler(await loader());
          if (!handler) {
            throw new Error(`MODULE_WEBHOOK_HANDLER_INVALID: ${definition.handler}`);
          }

          const receipt = await options.store.markWebhookReceipt(payload.receiptId, 'processing');
          const bodyText = payload.bodyText ?? receipt.bodyText ?? '';
          const request = createWebhookRequest({
            path: payload.path ?? receipt.path,
            method: payload.method ?? receipt.method,
            bodyText,
            headers: payload.headers ?? replayHeaders(receipt),
          });
          const ctx = createModuleBackgroundContext({
            host,
            contract,
            request,
            session: options.session,
            capabilities: options.capabilities,
          });
          const event: RuntimeStoreWebhookEvent = {
            request,
            receipt,
            bodyText,
            async json() {
              return bodyText ? JSON.parse(bodyText) : {};
            },
          };

          try {
            await handler(ctx, event);
            await options.store.markWebhookReceipt(payload.receiptId, 'processed');
          } catch (error) {
            await options.store.markWebhookReceipt(
              payload.receiptId,
              'failed',
              error instanceof Error ? error : String(error)
            );
            throw error;
          }
        },
      });
    },
  };
}
