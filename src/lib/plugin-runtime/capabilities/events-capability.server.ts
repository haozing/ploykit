import { Permission, PluginError, type PluginEvents } from '@ploykit/plugin-sdk';
import { eventBus } from '@/lib/bus/event-bus';
import type { EventHandler, EventMetadata } from '@/lib/bus/transports/types';
import {
  assertJsonSerializable,
  assertPluginNamespaced,
  enforceCapabilityPermission,
  type PluginCapabilityScope,
} from './guards.server';

export interface PluginEventsHost {
  emit(
    event: string,
    emitterId: string,
    payload: unknown,
    metadata?: {
      eventId?: string;
      correlationId?: string;
      causationId?: string;
      idempotencyKey?: string;
    }
  ): Promise<void>;
  on(event: string, pluginId: string, handler: EventHandler): void;
  off(event: string, pluginId: string): void;
}

export interface CreatePluginEventsOptions {
  host?: Partial<PluginEventsHost>;
}

const defaultEventsHost: PluginEventsHost = {
  emit: eventBus.emit.bind(eventBus),
  on: eventBus.on.bind(eventBus),
  off: eventBus.off.bind(eventBus),
};

function resolveHost(host?: Partial<PluginEventsHost>): PluginEventsHost {
  return {
    ...defaultEventsHost,
    ...host,
  };
}

export function createPluginEventsCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginEventsOptions = {}
): PluginEvents {
  const host = resolveHost(options.host);

  return {
    async emit(event, payload = {}) {
      enforceCapabilityPermission(scope, Permission.EventsEmit, 'ctx.events.emit');
      assertPluginNamespaced(scope, event, 'Event');
      assertJsonSerializable(payload, 'Event payload');

      await host.emit(event, scope.contract.id, payload, {
        correlationId: scope.requestId,
      });
    },

    on(event, handler) {
      enforceCapabilityPermission(scope, Permission.EventsSubscribe, 'ctx.events.on');

      const declaredSubscribes = scope.contract.definition.events?.subscribes ?? {};
      if (Object.keys(declaredSubscribes).length > 0 && !declaredSubscribes[event]) {
        throw new PluginError({
          code: 'PLUGIN_EVENT_SUBSCRIPTION_UNDECLARED',
          message: `Plugin event subscription "${event}" is not declared in plugin.ts.`,
          statusCode: 403,
          fix: 'Add the event to plugin.ts events.subscribes.',
          details: {
            pluginId: scope.contract.id,
            event,
          },
        });
      }

      host.on(event, scope.contract.id, (payload, metadata: EventMetadata) =>
        handler(payload, {
          event,
          emitterId: metadata.emitterId,
          timestamp: metadata.timestamp,
          eventId: metadata.eventId,
          correlationId: metadata.correlationId,
          causationId: metadata.causationId,
          idempotencyKey: metadata.idempotencyKey,
        })
      );
    },

    off(event) {
      enforceCapabilityPermission(scope, Permission.EventsSubscribe, 'ctx.events.off');
      host.off(event, scope.contract.id);
    },
  };
}
