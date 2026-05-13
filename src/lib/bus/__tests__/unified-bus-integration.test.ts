/**
 *
 *
 * Note：HookSystemTestat src/lib/hooks/__tests__ in
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from '../event-bus';
import { ServiceBus } from '../service-bus';
import type { EventHandler, ServiceHandler } from '../transports/types';

class TestUnifiedBus {
  public readonly event: EventBus;
  public readonly service: ServiceBus;

  constructor() {
    this.event = new EventBus();
    this.service = new ServiceBus();
  }

  onPluginEnabled(
    pluginId: string,
    capabilities: {
      events?: Array<{ event: string; handler: EventHandler }>;
      services?: Array<{ service: string; handler: ServiceHandler }>;
    }
  ): void {
    if (capabilities.events) {
      for (const { event, handler } of capabilities.events) {
        this.event.on(event, pluginId, handler);
      }
    }

    if (capabilities.services) {
      for (const { service, handler } of capabilities.services) {
        this.service.register(service, pluginId, handler);
      }
    }
  }

  onPluginDisabled(pluginId: string): void {
    this.event.removeAllListeners(pluginId);

    this.service.removeAllServices(pluginId);
  }

  getPluginRegistrations(pluginId: string) {
    return {
      events: this.event.getPluginSubscriptions(pluginId),
      services: this.service.getPluginServices(pluginId),
    };
  }

  clearAll(): void {
    this.event.clear();
    this.service.clear();
  }
}

describe('UnifiedBus Integration', () => {
  let bus: TestUnifiedBus;

  beforeEach(() => {
    bus = new TestUnifiedBus();
  });

  afterEach(() => {
    bus.clearAll();
  });

  // ==========================================================================
  // ==========================================================================

  describe('Plugin Enabled - onPluginEnabled', () => {
    it('shouldRegisterPluginofAll能力', () => {
      const eventHandler: EventHandler = vi.fn(async () => {});
      const serviceHandler: ServiceHandler = vi.fn(async () => ({ data: 'service' }));

      bus.onPluginEnabled('test-plugin', {
        events: [{ event: 'user.created', handler: eventHandler }],
        services: [{ service: 'service:test@v1', handler: serviceHandler }],
      });

      // ValidationEventRegister
      const eventSubscribers = bus.event.getListeners('user.created');
      expect(eventSubscribers).toContain('test-plugin');

      // ValidationServiceRegister
      expect(bus.service.hasService('service:test@v1')).toBe(true);
      expect(bus.service.getProvider('service:test@v1')).toBe('test-plugin');
    });

    it('shouldSupports只RegisterEvent', () => {
      const eventHandler: EventHandler = vi.fn(async () => {});

      bus.onPluginEnabled('test-plugin', {
        events: [{ event: 'test.event', handler: eventHandler }],
      });

      expect(bus.event.getListeners('test.event')).toContain('test-plugin');
      expect(bus.service.getPluginServices('test-plugin')).toEqual([]);
    });

    it('shouldSupports只RegisterService', () => {
      const serviceHandler: ServiceHandler = vi.fn(async () => ({}));

      bus.onPluginEnabled('test-plugin', {
        services: [{ service: 'service:test@v1', handler: serviceHandler }],
      });

      expect(bus.service.hasService('service:test@v1')).toBe(true);
      expect(bus.event.getPluginSubscriptions('test-plugin')).toEqual([]);
    });

    it('shouldSupportsRegistermultipleEvent监听器', () => {
      const handler1: EventHandler = vi.fn(async () => {});
      const handler2: EventHandler = vi.fn(async () => {});

      bus.onPluginEnabled('test-plugin', {
        events: [
          { event: 'user.created', handler: handler1 },
          { event: 'order.created', handler: handler2 },
        ],
      });

      const subscriptions = bus.event.getPluginSubscriptions('test-plugin');
      expect(subscriptions).toHaveLength(2);
      expect(subscriptions).toContain('user.created');
      expect(subscriptions).toContain('order.created');
    });

    it('shouldSupportsRegistermultipleService', () => {
      const handler1: ServiceHandler = vi.fn(async () => ({}));
      const handler2: ServiceHandler = vi.fn(async () => ({}));

      bus.onPluginEnabled('test-plugin', {
        services: [
          { service: 'service:a@v1', handler: handler1 },
          { service: 'service:b@v1', handler: handler2 },
        ],
      });

      const services = bus.service.getPluginServices('test-plugin');
      expect(services).toHaveLength(2);
      expect(services).toContain('service:a@v1');
      expect(services).toContain('service:b@v1');
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Plugin Disabled - onPluginDisabled', () => {
    it('should移除PluginofAll能力', () => {
      const eventHandler: EventHandler = vi.fn(async () => {});
      const serviceHandler: ServiceHandler = vi.fn(async () => ({}));

      // Enable
      bus.onPluginEnabled('test-plugin', {
        events: [{ event: 'user.created', handler: eventHandler }],
        services: [{ service: 'service:test@v1', handler: serviceHandler }],
      });

      // ValidationRegistered
      expect(bus.event.getListeners('user.created')).toContain('test-plugin');
      expect(bus.service.hasService('service:test@v1')).toBe(true);

      // Disable
      bus.onPluginDisabled('test-plugin');

      expect(bus.event.getListeners('user.created')).not.toContain('test-plugin');
      expect(bus.service.hasService('service:test@v1')).toBe(false);
    });

    it('Disable后Eventshould不再触发', async () => {
      const eventHandler = vi.fn(async () => {});

      bus.onPluginEnabled('test-plugin', {
        events: [{ event: 'test.event', handler: eventHandler }],
      });

      await bus.event.emit('test.event', 'emitter', {});
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(eventHandler).toHaveBeenCalledTimes(1);

      // Disable
      bus.onPluginDisabled('test-plugin');

      await bus.event.emit('test.event', 'emitter', {});
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(eventHandler).toHaveBeenCalledTimes(1);
    });

    it('Disable后Serviceshould不可用', async () => {
      const serviceHandler = vi.fn(async () => ({ data: 'test' }));

      bus.onPluginEnabled('test-plugin', {
        services: [{ service: 'service:test@v1', handler: serviceHandler }],
      });

      await bus.service.call('service:test@v1', {}, { callerId: 'test' });
      expect(serviceHandler).toHaveBeenCalledTimes(1);

      // Disable
      bus.onPluginDisabled('test-plugin');

      await expect(bus.service.call('service:test@v1', {}, { callerId: 'test' })).rejects.toThrow(
        'Service not found'
      );
    });

    it('should只移除指定Pluginof能力', () => {
      const handler1: EventHandler = vi.fn(async () => {});
      const handler2: EventHandler = vi.fn(async () => {});

      bus.onPluginEnabled('plugin-a', {
        events: [{ event: 'test.event', handler: handler1 }],
      });

      bus.onPluginEnabled('plugin-b', {
        events: [{ event: 'test.event', handler: handler2 }],
      });

      // Disableplugin-a
      bus.onPluginDisabled('plugin-a');

      const listeners = bus.event.getListeners('test.event');
      expect(listeners).not.toContain('plugin-a');
      expect(listeners).toContain('plugin-b');
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Query Operations - getPluginRegistrations', () => {
    it('shouldBackPluginofAllRegister信息', () => {
      bus.onPluginEnabled('test-plugin', {
        events: [
          { event: 'event-1', handler: async () => {} },
          { event: 'event-2', handler: async () => {} },
        ],
        services: [
          { service: 'service:a@v1', handler: async () => ({}) },
          { service: 'service:b@v1', handler: async () => ({}) },
        ],
      });

      const registrations = bus.getPluginRegistrations('test-plugin');

      expect(registrations.events).toHaveLength(2);
      expect(registrations.events).toContain('event-1');
      expect(registrations.events).toContain('event-2');

      expect(registrations.services).toHaveLength(2);
      expect(registrations.services).toContain('service:a@v1');
      expect(registrations.services).toContain('service:b@v1');
    });

    it('未RegisterofPluginshouldBack空List', () => {
      const registrations = bus.getPluginRegistrations('nonexistent-plugin');

      expect(registrations.events).toEqual([]);
      expect(registrations.services).toEqual([]);
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Clear All - clearAll', () => {
    it('should清空AllBus', () => {
      bus.onPluginEnabled('plugin-a', {
        events: [{ event: 'test.event', handler: async () => {} }],
        services: [{ service: 'service:test@v1', handler: async () => ({}) }],
      });

      bus.onPluginEnabled('plugin-b', {
        events: [{ event: 'test.event', handler: async () => {} }],
        services: [{ service: 'service:test2@v1', handler: async () => ({}) }],
      });

      //
      bus.clearAll();

      expect(bus.event.getListeners('test.event')).toEqual([]);
      expect(bus.service.listServices()).toEqual([]);
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Complete Plugin Lifecycle', () => {
    it('shouldSupportsCompleteofEnable-Disable-重新EnableFlow', async () => {
      const eventHandler = vi.fn(async () => {});
      const serviceHandler = vi.fn(async () => ({ result: 'ok' }));

      // 1. EnablePlugin
      bus.onPluginEnabled('test-plugin', {
        events: [{ event: 'test.event', handler: eventHandler }],
        services: [{ service: 'service:test@v1', handler: serviceHandler }],
      });

      await bus.event.emit('test.event', 'emitter', {});
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(eventHandler).toHaveBeenCalledTimes(1);

      await bus.service.call('service:test@v1', {}, { callerId: 'test' });
      expect(serviceHandler).toHaveBeenCalledTimes(1);

      // 2. DisablePlugin
      bus.onPluginDisabled('test-plugin');

      await bus.event.emit('test.event', 'emitter', {});
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(eventHandler).toHaveBeenCalledTimes(1); //

      await expect(bus.service.call('service:test@v1', {}, { callerId: 'test' })).rejects.toThrow(
        'Service not found'
      );

      bus.onPluginEnabled('test-plugin', {
        events: [{ event: 'test.event', handler: eventHandler }],
        services: [{ service: 'service:test@v1', handler: serviceHandler }],
      });

      await bus.event.emit('test.event', 'emitter', {});
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(eventHandler).toHaveBeenCalledTimes(2);

      await bus.service.call('service:test@v1', {}, { callerId: 'test' });
      expect(serviceHandler).toHaveBeenCalledTimes(2);
    });
  });
});
