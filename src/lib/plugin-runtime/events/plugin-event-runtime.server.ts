import { Permission, PluginError, type PluginContext } from '@ploykit/plugin-sdk';
import { eventBus } from '@/lib/bus/event-bus';
import type { EventMetadata } from '@/lib/bus';
import { createPluginRuntimeContext } from '../context';
import {
  getPluginRuntimeMapEntry,
  resolvePluginEventModule,
  type PluginRuntimeMapEntry,
} from '../loader';
import { pluginRuntimeRegistry } from '../registry';
import type { PluginRuntimeContract } from '../contract';

export interface RegisteredPluginEventSubscription {
  event: string;
  handler: string;
}

export interface PluginEventHandlerMetadata {
  event: string;
  emitterId: string;
  timestamp: Date;
  eventId: string;
  correlationId: string;
  causationId?: string;
  idempotencyKey?: string;
}

type PluginEventHandler = (
  ctx: PluginContext,
  payload: unknown,
  metadata: PluginEventHandlerMetadata
) => unknown | Promise<unknown>;

function createEventRequest(pluginId: string, event: string): Request {
  return new Request(
    `https://ploykit.local/plugins/${pluginId}/events/${encodeURIComponent(event)}`,
    {
      method: 'POST',
    }
  );
}

function getEventSubscriptions(contract: PluginRuntimeContract): Record<string, string> {
  return contract.events.subscribes ?? {};
}

function extractPluginEventHandler(module: unknown, event: string): PluginEventHandler {
  if (typeof module === 'function') {
    return module as PluginEventHandler;
  }

  if (module && typeof module === 'object') {
    const mod = module as Record<string, unknown>;
    const defaultExport = mod.default;
    const localName = event.includes('.') ? event.split('.').pop() : event;
    const handler =
      mod.handler ??
      (localName ? mod[localName] : undefined) ??
      (defaultExport && typeof defaultExport === 'object'
        ? (defaultExport as Record<string, unknown>).handler
        : defaultExport);

    if (typeof handler === 'function') {
      return handler as PluginEventHandler;
    }
  }

  throw new PluginError({
    code: 'PLUGIN_EVENT_HANDLER_INVALID',
    message: `Event subscription module for "${event}" must export a handler function.`,
    statusCode: 500,
    fix: 'Export a default function or named handler from the event subscription module.',
    details: {
      event,
    },
  });
}

async function resolveContract(
  pluginId: string,
  entry: PluginRuntimeMapEntry | null
): Promise<PluginRuntimeContract> {
  return pluginRuntimeRegistry.getOrLoad(pluginId, entry);
}

function assertEventContractPermissions(contract: PluginRuntimeContract): void {
  const subscribes = getEventSubscriptions(contract);

  if (
    Object.keys(subscribes).length === 0 ||
    contract.permissions.includes(Permission.EventsSubscribe)
  ) {
    return;
  }

  throw new PluginError({
    code: 'PLUGIN_EVENT_SUBSCRIBE_PERMISSION_MISSING',
    message: `Plugin "${contract.id}" declares event subscriptions but does not declare Permission.EventsSubscribe.`,
    statusCode: 403,
    fix: 'Add Permission.EventsSubscribe to plugin.ts permissions or remove events.subscribes.',
    details: {
      pluginId: contract.id,
      permission: Permission.EventsSubscribe,
    },
  });
}

export async function registerPluginRuntimeEvents(
  pluginId: string,
  entry: PluginRuntimeMapEntry | null = getPluginRuntimeMapEntry(pluginId)
): Promise<RegisteredPluginEventSubscription[]> {
  const contract = await resolveContract(pluginId, entry);
  assertEventContractPermissions(contract);
  unregisterPluginRuntimeEvents(pluginId);

  const registered: RegisteredPluginEventSubscription[] = [];

  for (const [event, handlerPath] of Object.entries(getEventSubscriptions(contract))) {
    const moduleLoader = entry ? resolvePluginEventModule(entry, handlerPath) : null;
    if (!moduleLoader) {
      throw new PluginError({
        code: 'PLUGIN_EVENT_HANDLER_NOT_FOUND',
        message: `Event subscription handler "${handlerPath}" was not found for plugin "${pluginId}".`,
        statusCode: 500,
        fix: 'Run npm run plugins:scan and ensure the event handler exists inside the plugin.',
        details: {
          pluginId,
          event,
          handler: handlerPath,
        },
      });
    }

    const handler = extractPluginEventHandler(await moduleLoader(), event);

    eventBus.on(event, pluginId, async (payload: unknown, metadata: EventMetadata) => {
      const ctx = createPluginRuntimeContext({
        contract,
        request: createEventRequest(pluginId, event),
        user: null,
        system: true,
      });

      await handler(ctx, payload, {
        event,
        emitterId: metadata.emitterId,
        timestamp: metadata.timestamp,
        eventId: metadata.eventId,
        correlationId: metadata.correlationId,
        causationId: metadata.causationId,
        idempotencyKey: metadata.idempotencyKey,
      });
    });

    registered.push({
      event,
      handler: handlerPath,
    });
  }

  return registered;
}

export function unregisterPluginRuntimeEvents(pluginId: string): number {
  const removed = eventBus.getPluginSubscriptions(pluginId).length;
  eventBus.removeAllListeners(pluginId);
  return removed;
}
