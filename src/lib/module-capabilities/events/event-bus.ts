import type { ModuleContext } from '@ploykit/module-sdk';
import { readModuleDefaultExport } from '../../module-runtime/adapters';
import {
  createModuleBackgroundContext,
  type ModuleBackgroundContextCapabilities,
} from '../../module-runtime/context';
import type { ModuleRuntimeHost } from '../../module-runtime/host/module-runtime-host';
import type { ModuleRuntimeAccessSession } from '../../module-runtime/security';
import {
  createInMemoryModuleEventOutbox,
  type ModuleEventEnvelope,
  type ModuleEventMetadata,
  type ModuleEventOutbox,
} from './outbox';

export type ModuleEventHandler<TPayload = unknown> = (
  ctx: ModuleContext,
  event: ModuleEventEnvelope<TPayload>
) => unknown | Promise<unknown>;

export interface ModuleEventPublishInput<TPayload = unknown> {
  moduleId?: string;
  name: string;
  payload: TPayload;
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;
}

export interface ModuleEventHandlerResult {
  moduleId: string;
  eventName: string;
  ok: boolean;
  error?: string;
}

export interface ModuleEventDrainResult {
  processed: number;
  failed: number;
  handlers: ModuleEventHandlerResult[];
}

export interface CreateModuleEventBusOptions {
  outbox?: ModuleEventOutbox;
  session?: ModuleRuntimeAccessSession;
  capabilities?: ModuleBackgroundContextCapabilities;
}

export interface ModuleEventBus {
  outbox: ModuleEventOutbox;
  publish<TPayload = unknown>(
    input: ModuleEventPublishInput<TPayload>
  ): Promise<ModuleEventEnvelope<TPayload>>;
  drain(limit?: number): Promise<ModuleEventDrainResult>;
}

function normalizeModulePath(value: string): string {
  return value.replace(/^\.\//, '');
}

function asEventHandler(value: unknown): ModuleEventHandler | null {
  const exported = readModuleDefaultExport(value);
  if (typeof exported === 'function') {
    return exported as ModuleEventHandler;
  }
  if (exported && typeof exported === 'object' && 'handle' in exported) {
    const handle = (exported as { handle?: unknown }).handle;
    return typeof handle === 'function' ? (handle as ModuleEventHandler) : null;
  }
  return null;
}

export function createModuleEventBus(
  host: ModuleRuntimeHost,
  options: CreateModuleEventBusOptions = {}
): ModuleEventBus {
  const outbox = options.outbox ?? createInMemoryModuleEventOutbox();

  return {
    outbox,
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

      const metadata: ModuleEventMetadata = {
        correlationId: input.correlationId,
        causationId: input.causationId,
        idempotencyKey: input.idempotencyKey,
        sourceModuleId: input.moduleId,
      };

      return outbox.enqueue({
        name: input.name,
        payload: input.payload,
        metadata,
      });
    },
    async drain(limit = 50) {
      const events = outbox.claimBatch(limit);
      const result: ModuleEventDrainResult = {
        processed: 0,
        failed: 0,
        handlers: [],
      };

      for (const event of events) {
        const matchingContracts = host.contracts.filter(
          (contract) => contract.events.subscribes[event.name]
        );
        let failed = false;

        for (const contract of matchingContracts) {
          const handlerPath = contract.events.subscribes[event.name];
          const entry = host.getMapEntry(contract.id);
          const loader = entry?.events?.[normalizeModulePath(handlerPath)];
          if (!loader) {
            failed = true;
            result.handlers.push({
              moduleId: contract.id,
              eventName: event.name,
              ok: false,
              error: `MODULE_EVENT_HANDLER_MISSING: ${handlerPath}`,
            });
            continue;
          }

          try {
            const handler = asEventHandler(await loader());
            if (!handler) {
              throw new Error(`MODULE_EVENT_HANDLER_INVALID: ${handlerPath}`);
            }
            const request = new Request(
              `http://localhost/modules/${contract.id}/events/${encodeURIComponent(event.name)}`,
              { method: 'POST' }
            );
            const ctx = createModuleBackgroundContext({
              host,
              contract,
              request,
              session: options.session,
              capabilities: options.capabilities,
            });
            await handler(ctx, event);
            result.handlers.push({
              moduleId: contract.id,
              eventName: event.name,
              ok: true,
            });
          } catch (error) {
            failed = true;
            result.handlers.push({
              moduleId: contract.id,
              eventName: event.name,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        if (failed) {
          outbox.markFailed(event.id, 'One or more event handlers failed.');
          result.failed += 1;
        } else {
          outbox.markProcessed(event.id);
          result.processed += 1;
        }
      }

      return result;
    },
  };
}
