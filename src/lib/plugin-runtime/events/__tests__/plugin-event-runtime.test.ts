import { beforeEach, describe, expect, it } from 'vitest';
import { definePlugin, Permission, type PluginContext } from '@ploykit/plugin-sdk';
import { eventBus } from '@/lib/bus/event-bus';
import { normalizePluginRuntimeContract } from '../../contract';
import type { PluginRuntimeMapEntry } from '../../loader';
import { pluginRuntimeRegistry } from '../../registry';
import {
  registerPluginRuntimeEvents,
  unregisterPluginRuntimeEvents,
} from '../plugin-event-runtime.server';

function createEntry(overrides: Partial<PluginRuntimeMapEntry> = {}): PluginRuntimeMapEntry {
  const contract = normalizePluginRuntimeContract(
    definePlugin({
      id: 'runtime-events',
      name: 'Runtime Events',
      version: '1.0.0',
      permissions: [Permission.EventsSubscribe, Permission.JobsEnqueue],
      events: {
        subscribes: {
          'platform.user.created': './events/user-created',
        },
      },
    })
  );

  return {
    runtimeContract: contract,
    ...overrides,
  };
}

describe('plugin event runtime', () => {
  beforeEach(() => {
    eventBus.clear();
    pluginRuntimeRegistry.clear();
  });

  it('registers declared event subscriptions and runs handlers with plugin context', async () => {
    const handled: unknown[] = [];
    const entry = createEntry({
      eventModules: {
        'events/user-created': async () => ({
          default: async (
            ctx: PluginContext,
            payload: unknown,
            metadata: { event: string; emitterId: string; eventId: string; correlationId: string }
          ) => {
            handled.push({
              pluginId: ctx.plugin.id,
              payload,
              event: metadata.event,
              emitterId: metadata.emitterId,
              eventId: metadata.eventId,
              correlationId: metadata.correlationId,
            });
          },
        }),
      },
    });

    const registered = await registerPluginRuntimeEvents('runtime-events', entry);
    await eventBus.emit(
      'platform.user.created',
      'platform',
      { userId: 'user-1' },
      {
        eventId: 'event-1',
        correlationId: 'corr-1',
      }
    );

    expect(registered).toEqual([
      {
        event: 'platform.user.created',
        handler: './events/user-created',
      },
    ]);
    expect(eventBus.getPluginSubscriptions('runtime-events')).toEqual(['platform.user.created']);
    expect(handled).toEqual([
      {
        pluginId: 'runtime-events',
        payload: { userId: 'user-1' },
        event: 'platform.user.created',
        emitterId: 'platform',
        eventId: 'event-1',
        correlationId: 'corr-1',
      },
    ]);
  });

  it('re-registers subscriptions without duplicating handlers', async () => {
    const handled: unknown[] = [];
    const entry = createEntry({
      eventModules: {
        'events/user-created': async () => ({
          default: async () => {
            handled.push('called');
          },
        }),
      },
    });

    await registerPluginRuntimeEvents('runtime-events', entry);
    await registerPluginRuntimeEvents('runtime-events', entry);
    await eventBus.emit('platform.user.created', 'platform', {});

    expect(handled).toEqual(['called']);
  });

  it('unregisters event subscriptions by plugin id', async () => {
    const entry = createEntry({
      eventModules: {
        'events/user-created': async () => ({ default: async () => undefined }),
      },
    });

    await registerPluginRuntimeEvents('runtime-events', entry);

    expect(unregisterPluginRuntimeEvents('runtime-events')).toBe(1);
    expect(eventBus.getPluginSubscriptions('runtime-events')).toEqual([]);
  });

  it('fails when a declared event handler is missing from the runtime map', async () => {
    await expect(
      registerPluginRuntimeEvents('runtime-events', createEntry())
    ).rejects.toMatchObject({
      code: 'PLUGIN_EVENT_HANDLER_NOT_FOUND',
      details: {
        event: 'platform.user.created',
        handler: './events/user-created',
      },
    });
  });
});
