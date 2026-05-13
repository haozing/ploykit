/**
 * Event Bus SubscriptionFeatureTest
 *
 *
 *
 * @see docs/testing/event-bus-tests.md - CompleteTestDocumentation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from '../event-bus';
import {
  createMockEventHandler,
  createRecordingHandler,
  waitForEventProcessing,
  expectHandlerCalledWith,
  cleanupEventBus,
} from './helpers';
import type { EventMetadata } from '../transports/types';

describe('EventBus - Subscription', () => {
  // ====================
  let eventBus: EventBus;

  beforeEach(() => {
    // CreatenewEventBusInstance
    eventBus = new EventBus();
  });

  afterEach(() => {
    // Clean upEventBusStatus
    cleanupEventBus(eventBus);
  });

  // ==========================================================================
  // ==========================================================================

  describe('Basic Subscription', () => {
    it('shouldSuccessSubscription一Event', async () => {
      // ===== Description =====
      // 2. SubscriptionEvent
      // =================

      const handler = createMockEventHandler();

      // 2: SubscriptionEvent
      // Parameter: (Event name, PluginID, handlerFunction)
      eventBus.on('user.created', 'test-plugin', handler);

      await eventBus.emit('user.created', 'auth-service', {
        userId: '123',
        email: 'test@example.com',
      });

      await waitForEventProcessing(100);

      expectHandlerCalledWith(
        handler,
        { userId: '123', email: 'test@example.com' },
        { emitterId: 'auth-service' }
      );
    });

    it('should允许同一PluginSubscriptionmultiple不同Event', async () => {
      // ===== Description =====
      // =================

      const handler1 = createMockEventHandler();
      const handler2 = createMockEventHandler();

      eventBus.on('user.created', 'test-plugin', handler1);
      eventBus.on('user.updated', 'test-plugin', handler2);

      // Event
      await eventBus.emit('user.created', 'auth', { userId: '1' });
      await waitForEventProcessing(100);

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(0);

      // Event
      await eventBus.emit('user.updated', 'auth', { userId: '2' });
      await waitForEventProcessing(100);

      expect(handler1).toHaveBeenCalledTimes(1); // Yes1times
      expect(handler2).toHaveBeenCalledTimes(1); // atYes1times
    });

    it('should允许重复Subscription同一Event（会CreatemultipleSubscription）', async () => {
      // ===== Description =====
      // =================

      const handler1 = createMockEventHandler();
      const handler2 = createMockEventHandler();

      eventBus.on('user.created', 'test-plugin', handler1);
      eventBus.on('user.created', 'test-plugin', handler2);

      const listeners = eventBus.getListeners('user.created');
      expect(listeners).toContain('test-plugin');

      await eventBus.emit('user.created', 'auth', { userId: '1' });
      await waitForEventProcessing(100);

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should正确传递Completeofmetadata给handler', async () => {
      // ===== Description =====
      // =================

      const receivedData: Array<{ payload: unknown; metadata: EventMetadata; timestamp: Date }> =
        [];
      const handler = createRecordingHandler(receivedData);

      eventBus.on('test.event', 'test-plugin', handler);

      await eventBus.emit('test.event', 'sender-id', { data: 'test' });
      await waitForEventProcessing(100);

      expect(receivedData.length).toBe(1);

      const { payload, metadata } = receivedData[0];

      // Validationpayload
      expect(payload).toEqual({ data: 'test' });

      expect(metadata.emitterId).toBe('sender-id');
      expect(metadata.timestamp).toBeInstanceOf(Date);
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Multiple Subscribers', () => {
    it('shouldSupportsmultiplePluginSubscription同一Event', async () => {
      // ===== Description =====
      // =================

      const handler1 = createMockEventHandler();
      const handler2 = createMockEventHandler();
      const handler3 = createMockEventHandler();

      eventBus.on('order.created', 'plugin-a', handler1);
      eventBus.on('order.created', 'plugin-b', handler2);
      eventBus.on('order.created', 'plugin-c', handler3);

      // Event
      await eventBus.emit('order.created', 'order-service', {
        orderId: '456',
      });
      await waitForEventProcessing(100);

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
      expect(handler3).toHaveBeenCalledTimes(1);
    });

    it('should并行执行AllSubscription者ofhandler', async () => {
      // ===== Description =====
      // =================

      const executionLog: string[] = [];

      const fastHandler = vi.fn(async () => {
        executionLog.push('fast-start');
        await new Promise((resolve) => setTimeout(resolve, 10));
        executionLog.push('fast-end');
      });

      const slowHandler = vi.fn(async () => {
        executionLog.push('slow-start');
        await new Promise((resolve) => setTimeout(resolve, 50));
        executionLog.push('slow-end');
      });

      eventBus.on('test.event', 'fast-plugin', fastHandler);
      eventBus.on('test.event', 'slow-plugin', slowHandler);

      await eventBus.emit('test.event', 'sender', {});
      await waitForEventProcessing(100);

      expect(fastHandler).toHaveBeenCalled();
      expect(slowHandler).toHaveBeenCalled();

      expect(executionLog[0]).toBe('fast-start');
      expect(executionLog[1]).toBe('slow-start');
    });

    it('should隔离不同Subscription者ofError', async () => {
      // ===== Description =====
      // =================

      const successHandler = createMockEventHandler();
      const failingHandler = vi.fn(async () => {
        throw new Error('Handler failed');
      });

      eventBus.on('test.event', 'good-plugin', successHandler);
      eventBus.on('test.event', 'bad-plugin', failingHandler);

      await expect(eventBus.emit('test.event', 'sender', {})).resolves.not.toThrow();

      await waitForEventProcessing(100);

      expect(successHandler).toHaveBeenCalled();
      expect(failingHandler).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Input Validation', () => {
    it('should拒绝空ofEvent name', () => {
      // ===== Description =====
      // =================

      const handler = createMockEventHandler();

      expect(() => {
        eventBus.on('', 'test-plugin', handler);
      }).toThrow();
    });

    it('should拒绝空ofPluginID', () => {
      // ===== Description =====
      // =================

      const handler = createMockEventHandler();

      expect(() => {
        eventBus.on('test.event', '', handler);
      }).toThrow();
    });

    it('should拒绝非Functionofhandler', () => {
      // ===== Description =====
      // =================

      expect(() => {
        // @ts-expect-error - Testing runtime validation with invalid handler type
        eventBus.on('test.event', 'test-plugin', 'not-a-function');
      }).toThrow();

      expect(() => {
        // @ts-expect-error - Testing runtime validation with null handler
        eventBus.on('test.event', 'test-plugin', null);
      }).toThrow();
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Query Operations', () => {
    it('shouldBack指定EventofAllSubscription者', () => {
      // ===== Description =====
      // =================

      const handler = createMockEventHandler();

      // SubscriptionmultiplePlugin
      eventBus.on('test.event', 'plugin-a', handler);
      eventBus.on('test.event', 'plugin-b', handler);
      eventBus.on('test.event', 'plugin-c', handler);

      const listeners = eventBus.getListeners('test.event');

      expect(listeners.length).toBe(3);
      expect(listeners).toContain('plugin-a');
      expect(listeners).toContain('plugin-b');
      expect(listeners).toContain('plugin-c');
    });

    it('shouldfordoes not existofEventBack空Array', () => {
      // ===== Description =====
      // =================

      const listeners = eventBus.getListeners('nonexistent.event');

      expect(Array.isArray(listeners)).toBe(true);
      expect(listeners.length).toBe(0);
    });

    it('shouldQueryPluginSubscriptionofAllEvent', () => {
      // ===== Description =====
      // =================

      const handler = createMockEventHandler();

      // SubscriptionmultipleEvent
      eventBus.on('user.created', 'test-plugin', handler);
      eventBus.on('user.updated', 'test-plugin', handler);
      eventBus.on('order.created', 'test-plugin', handler);

      const subscriptions = eventBus.getPluginSubscriptions('test-plugin');

      expect(subscriptions.length).toBe(3);
      expect(subscriptions).toContain('user.created');
      expect(subscriptions).toContain('user.updated');
      expect(subscriptions).toContain('order.created');
    });

    it('shouldBackPluginSubscriptionofEvent（即使有multiplePluginSubscription）', () => {
      // ===== Description =====
      // =================

      const handler = createMockEventHandler();

      eventBus.on('user.created', 'plugin-a', handler);
      eventBus.on('user.created', 'plugin-b', handler);
      eventBus.on('order.created', 'plugin-a', handler);

      // Queryplugin-aSubscriptionofEvent
      const eventsA = eventBus.getPluginSubscriptions('plugin-a');
      expect(eventsA).toContain('user.created');
      expect(eventsA).toContain('order.created');

      // Queryplugin-bSubscriptionofEvent
      const eventsB = eventBus.getPluginSubscriptions('plugin-b');
      expect(eventsB).toContain('user.created');
      expect(eventsB).not.toContain('order.created');
    });
  });

  // ==========================================================================
  // 5. CancelSubscription
  // ==========================================================================

  describe('Unsubscribe', () => {
    it('shouldSuccessCancelSubscription', async () => {
      // ===== Description =====
      // =================

      const handler = createMockEventHandler();

      // Subscription
      eventBus.on('test.event', 'test-plugin', handler);

      // CancelSubscription
      eventBus.off('test.event', 'test-plugin');

      // Event
      await eventBus.emit('test.event', 'sender', {});
      await waitForEventProcessing(100);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should只Cancel指定PluginofSubscription', async () => {
      // ===== Description =====
      // =================

      const handler1 = createMockEventHandler();
      const handler2 = createMockEventHandler();

      eventBus.on('test.event', 'plugin-a', handler1);
      eventBus.on('test.event', 'plugin-b', handler2);

      // Cancelplugin-aofSubscription
      eventBus.off('test.event', 'plugin-a');

      // Event
      await eventBus.emit('test.event', 'sender', {});
      await waitForEventProcessing(100);

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should允许Canceldoes not existofSubscription（不ThrowError）', () => {
      // ===== Description =====
      // shouldThrowError
      // =================

      expect(() => {
        eventBus.off('nonexistent.event', 'test-plugin');
      }).not.toThrow();
    });

    it('should清除AllSubscription', async () => {
      // ===== Description =====
      // =================

      const handler = createMockEventHandler();

      // SubscriptionmultipleEvent
      eventBus.on('event-1', 'plugin-a', handler);
      eventBus.on('event-2', 'plugin-b', handler);

      // AllSubscription
      eventBus.clear();

      // Event
      await eventBus.emit('event-1', 'sender', {});
      await eventBus.emit('event-2', 'sender', {});
      await waitForEventProcessing(100);

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
