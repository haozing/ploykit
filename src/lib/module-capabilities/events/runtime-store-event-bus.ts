import type { ModuleContext } from '@ploykit/module-sdk';
import { readModuleDefaultExport } from '../../module-runtime/adapters';
import {
  createModuleBackgroundContext,
  type ModuleBackgroundContextCapabilities,
} from '../../module-runtime/context';
import type { ModuleRuntimeHost } from '../../module-runtime/host';
import {
  createRuntimeStoreQueue,
  type RuntimeStoreQueue,
  type RuntimeStoreQueueDrainResult,
} from '../../module-runtime/queue';
import type { RuntimeStore } from '../../module-runtime/stores';
import type { ModuleRuntimeAccessSession } from '../../module-runtime/security';

export interface RuntimeStoreEventEnvelope<TPayload = unknown> {
  id: string;
  name: string;
  payload: TPayload;
  correlationId?: string;
  causationId?: string;
  sourceModuleId?: string;
  attempts: number;
}

export type RuntimeStoreEventHandler<TPayload = unknown> = (
  ctx: ModuleContext,
  event: RuntimeStoreEventEnvelope<TPayload>
) => unknown | Promise<unknown>;

export interface RuntimeStoreEventBus {
  queue: RuntimeStoreQueue;
  publish<TPayload = unknown>(input: {
    moduleId?: string;
    name: string;
    payload: TPayload;
    correlationId?: string;
    causationId?: string;
    idempotencyKey?: string;
    maxAttempts?: number;
  }): Promise<unknown>;
  drain(input?: {
    limit?: number;
    concurrency?: number;
    maxAttempts?: number;
    leaseOwner?: string;
    leaseMs?: number;
    retryBackoffMs?: number;
  }): Promise<{
    processed: number;
    failed: number;
    deadLettered: number;
    durationMs: number;
    records: RuntimeStoreQueueDrainResult['records'];
    handlers: {
      moduleId: string;
      eventName: string;
      ok: boolean;
      skipped?: boolean;
      error?: string;
    }[];
  }>;
}

export interface CreateRuntimeStoreEventBusOptions {
  store: RuntimeStore;
  productId: string;
  workspaceId?: string | null;
  session?: ModuleRuntimeAccessSession;
  capabilities?: ModuleBackgroundContextCapabilities;
}

function normalizeModulePath(value: string): string {
  return value.replace(/^\.\//, '');
}

function asEventHandler(value: unknown): RuntimeStoreEventHandler | null {
  const exported = readModuleDefaultExport(value);
  if (typeof exported === 'function') {
    return exported as RuntimeStoreEventHandler;
  }
  if (exported && typeof exported === 'object' && 'handle' in exported) {
    const handle = (exported as { handle?: unknown }).handle;
    return typeof handle === 'function' ? (handle as RuntimeStoreEventHandler) : null;
  }
  return null;
}

function maxAttemptsForMessage(
  message: { attempts: number; metadata?: Record<string, unknown> },
  override: number | undefined
): number {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return override;
  }
  const metadataMaxAttempts = message.metadata?.maxAttempts;
  if (
    typeof metadataMaxAttempts === 'number' &&
    Number.isFinite(metadataMaxAttempts) &&
    metadataMaxAttempts > 0
  ) {
    return metadataMaxAttempts;
  }
  return 3;
}

function retryAtForMessage(
  message: { attempts: number; metadata?: Record<string, unknown> },
  retryBackoffMs: number | undefined
): string | null {
  if (typeof retryBackoffMs !== 'number' || !Number.isFinite(retryBackoffMs) || retryBackoffMs <= 0) {
    return null;
  }
  const maxAttempts = maxAttemptsForMessage(message, undefined);
  if (message.attempts >= maxAttempts) {
    return null;
  }
  return new Date(Date.now() + retryBackoffMs).toISOString();
}

function eventSubscriberTarget(moduleId: string, handlerPath: string): string {
  return `${moduleId}:${normalizeModulePath(handlerPath)}`;
}

export function createRuntimeStoreEventBus(
  host: ModuleRuntimeHost,
  options: CreateRuntimeStoreEventBusOptions
): RuntimeStoreEventBus {
  const queue = createRuntimeStoreQueue({
    store: options.store,
    productId: options.productId,
    workspaceId: options.workspaceId,
    moduleId: null,
  });

  return {
    queue,
    async publish(input) {
      if (input.moduleId) {
        const contract = host.getContract(input.moduleId);
        if (!contract) {
          throw new Error(`MODULE_EVENT_SOURCE_NOT_FOUND: ${input.moduleId}`);
        }
        if (!contract.events.publishes.includes(input.name)) {
          throw new Error(`MODULE_EVENT_NOT_DECLARED: ${input.moduleId}.${input.name}`);
        }
      }
      return queue.enqueue({
        name: `event:${input.name}`,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
        maxAttempts: input.maxAttempts,
        metadata: {
          eventName: input.name,
          correlationId: input.correlationId,
          causationId: input.causationId,
          sourceModuleId: input.moduleId,
        },
      });
    },
    async drain(input = {}) {
      const handlers: {
        moduleId: string;
        eventName: string;
        ok: boolean;
        skipped?: boolean;
        error?: string;
      }[] = [];
      const drainResult = await queue.drain({
        namePrefix: 'event:',
        limit: input.limit,
        concurrency: input.concurrency,
        maxAttempts: input.maxAttempts,
        leaseOwner: input.leaseOwner,
        leaseMs: input.leaseMs,
        retryBackoffMs: input.retryBackoffMs,
        handler: async (message) => {
          const eventName = String(
            message.metadata.eventName ?? message.name.replace(/^event:/, '')
          );
          const matchingContracts = host.contracts.filter(
            (contract) => contract.events.subscribes[eventName]
          );
          const previousDeliveries = await options.store.listDeliveries({
            productId: options.productId,
            workspaceId: options.workspaceId,
            kind: 'event',
            outboxId: message.id,
          });
          const deliveredTargets = new Set(
            previousDeliveries
              .filter((delivery) => delivery.status === 'delivered')
              .map((delivery) => delivery.target)
          );
          const skippedTargets = new Set(
            previousDeliveries
              .filter((delivery) => delivery.status === 'skipped')
              .map((delivery) => delivery.target)
          );
          const failures: string[] = [];

          for (const contract of matchingContracts) {
            const handlerPath = contract.events.subscribes[eventName];
            const target = eventSubscriberTarget(contract.id, handlerPath);
            if (deliveredTargets.has(target)) {
              if (!skippedTargets.has(target)) {
                await options.store.recordDelivery({
                  productId: options.productId,
                  workspaceId: options.workspaceId,
                  moduleId: contract.id,
                  kind: 'event',
                  source: `event:${eventName}`,
                  target,
                  status: 'skipped',
                  attempts: message.attempts,
                  outboxId: message.id,
                  eventId: message.id,
                  correlationId: message.metadata.correlationId as string | undefined,
                  causationId: message.metadata.causationId as string | undefined,
                  metadata: {
                    eventName,
                    handlerPath: normalizeModulePath(handlerPath),
                    subscriberModuleId: contract.id,
                    sourceModuleId: message.metadata.sourceModuleId,
                    skipReason: 'already_delivered',
                  },
                });
              }
              handlers.push({ moduleId: contract.id, eventName, ok: true, skipped: true });
              continue;
            }
            const entry = host.getMapEntry(contract.id);
            const loader = entry?.events?.[normalizeModulePath(handlerPath)];
            try {
              if (!loader) {
                throw new Error(`MODULE_EVENT_HANDLER_MISSING: ${handlerPath}`);
              }
              const handler = asEventHandler(await loader());
              if (!handler) {
                throw new Error(`MODULE_EVENT_HANDLER_INVALID: ${handlerPath}`);
              }
              const request = new Request(
                `http://localhost/modules/${contract.id}/events/${encodeURIComponent(eventName)}`,
                { method: 'POST' }
              );
              const ctx = createModuleBackgroundContext({
                host,
                contract,
                request,
                session: options.session,
                capabilities: options.capabilities,
              });
              await handler(ctx, {
                id: message.id,
                name: eventName,
                payload: message.payload,
                correlationId: message.metadata.correlationId as string | undefined,
                causationId: message.metadata.causationId as string | undefined,
                sourceModuleId: message.metadata.sourceModuleId as string | undefined,
                attempts: message.attempts,
              });
              await options.store.recordDelivery({
                productId: options.productId,
                workspaceId: options.workspaceId,
                moduleId: contract.id,
                kind: 'event',
                source: `event:${eventName}`,
                target,
                status: 'delivered',
                attempts: message.attempts,
                outboxId: message.id,
                eventId: message.id,
                correlationId: message.metadata.correlationId as string | undefined,
                causationId: message.metadata.causationId as string | undefined,
                metadata: {
                  eventName,
                  handlerPath: normalizeModulePath(handlerPath),
                  subscriberModuleId: contract.id,
                  sourceModuleId: message.metadata.sourceModuleId,
                },
              });
              handlers.push({ moduleId: contract.id, eventName, ok: true });
            } catch (error) {
              const messageText = error instanceof Error ? error.message : String(error);
              const maxAttempts = maxAttemptsForMessage(message, input.maxAttempts);
              const status = message.attempts >= maxAttempts ? 'dead_letter' : 'failed';
              failures.push(messageText);
              await options.store.recordDelivery({
                productId: options.productId,
                workspaceId: options.workspaceId,
                moduleId: contract.id,
                kind: 'event',
                source: `event:${eventName}`,
                target,
                status,
                attempts: message.attempts,
                outboxId: message.id,
                eventId: message.id,
                correlationId: message.metadata.correlationId as string | undefined,
                causationId: message.metadata.causationId as string | undefined,
                nextRetryAt:
                  status === 'failed' && typeof input.retryBackoffMs === 'number'
                    ? retryAtForMessage(
                        message,
                        input.retryBackoffMs
                      )
                    : null,
                errorCategory: error instanceof Error ? error.name : 'MODULE_EVENT_HANDLER_FAILED',
                error: error instanceof Error ? error : String(error),
                metadata: {
                  eventName,
                  handlerPath: normalizeModulePath(handlerPath),
                  subscriberModuleId: contract.id,
                  sourceModuleId: message.metadata.sourceModuleId,
                },
              });
              handlers.push({
                moduleId: contract.id,
                eventName,
                ok: false,
                error: messageText,
              });
            }
          }

          if (failures.length > 0) {
            throw new Error(failures.join('; '));
          }
        },
      });
      return {
        processed: drainResult.processed,
        failed: drainResult.failed,
        deadLettered: drainResult.deadLettered,
        durationMs: drainResult.durationMs,
        records: drainResult.records,
        handlers,
      };
    },
  };
}
