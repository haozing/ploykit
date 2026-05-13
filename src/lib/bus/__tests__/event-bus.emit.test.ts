/**
 * Event Bus PublishFeatureTest
 *
 *
 *
 * @see docs/testing/event-bus-tests.md - CompleteTestDocumentation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { EventMetadata } from '../transports/types';
import { EventBus } from '../event-bus';
import {
  createMockEventHandler,
  createRecordingHandler,
  waitForEventProcessing,
  expectHandlerCalledWith,
  cleanupEventBus,
} from './helpers';

describe('EventBus - Publishing (Emit)', () => {
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

  describe('Basic Publishing', () => {
    it('shouldSuccessPublishEvent并触发Subscription者', async () => {
      // ===== Description =====
      // 1. SubscriptionEvent
      // 2. PublishEvent
      // =================

      const handler = createMockEventHandler();

      // 1: SubscriptionEvent
      eventBus.on('user.created', 'test-plugin', handler);

      // 2: PublishEvent
      await eventBus.emit('user.created', 'auth-service', {
        userId: '123',
        email: 'test@example.com',
      });

      await waitForEventProcessing(100);

      expect(handler).toHaveBeenCalledTimes(1);
      expectHandlerCalledWith(
        handler,
        { userId: '123', email: 'test@example.com' },
        { emitterId: 'auth-service' }
      );
    });

    it('shouldSupportsPublishmultipledifferentEvent', async () => {
      // ===== Description =====
      // =================

      const handler1 = createMockEventHandler();
      const handler2 = createMockEventHandler();

      eventBus.on('user.created', 'test-plugin', handler1);
      eventBus.on('user.updated', 'test-plugin', handler2);

      await eventBus.emit('user.created', 'auth', { userId: '1' });
      await waitForEventProcessing(100);

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(0);

      await eventBus.emit('user.updated', 'auth', { userId: '2' });
      await waitForEventProcessing(100);

      expect(handler1).toHaveBeenCalledTimes(1); // Yes1times
      expect(handler2).toHaveBeenCalledTimes(1); // atYes1times
    });

    it('shouldSupports连续Publish同一Event', async () => {
      // ===== Description =====
      // =================

      const handler = createMockEventHandler();
      eventBus.on('order.created', 'test-plugin', handler);

      // Publish3times
      await eventBus.emit('order.created', 'order-service', { orderId: '1' });
      await eventBus.emit('order.created', 'order-service', { orderId: '2' });
      await eventBus.emit('order.created', 'order-service', { orderId: '3' });

      await waitForEventProcessing(100);

      expect(handler).toHaveBeenCalledTimes(3);
    });

    it('should允许payloadas空orundefined', async () => {
      // ===== Description =====
      // =================

      const handler = createMockEventHandler();
      eventBus.on('test.event', 'test-plugin', handler);

      await eventBus.emit('test.event', 'sender', undefined);
      await waitForEventProcessing(100);

      expect(handler).toHaveBeenCalledTimes(1);
      const call = handler.mock.calls[0];
      expect(call[0]).toBeUndefined(); // payloadYesundefined
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Async Execution', () => {
    it('emitshould立即Back，不etc待Subscription者执行', async () => {
      // ===== Description =====
      // =================

      let handlerStarted = false;
      let handlerCompleted = false;

      const slowHandler = vi.fn(async () => {
        handlerStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 50));
        handlerCompleted = true;
      });

      eventBus.on('test.event', 'slow-plugin', slowHandler);

      const startTime = Date.now();
      await eventBus.emit('test.event', 'sender', {});
      const emitDuration = Date.now() - startTime;

      expect(emitDuration).toBeLessThan(10);

      expect(handlerCompleted).toBe(false);

      await waitForEventProcessing(100);

      expect(handlerStarted).toBe(true);
      expect(handlerCompleted).toBe(true);
    });

    it('Publish者不shouldbeSubscription者ofError阻塞', async () => {
      // ===== Description =====
      // =================

      const failingHandler = vi.fn(async () => {
        throw new Error('Subscriber failed');
      });

      eventBus.on('test.event', 'bad-plugin', failingHandler);

      await expect(eventBus.emit('test.event', 'sender', {})).resolves.not.toThrow();

      await waitForEventProcessing(100);

      expect(failingHandler).toHaveBeenCalled();
    });

    it('shouldUsequeueMicrotaskimplementAsync执行', async () => {
      // ===== Description =====
      // =================

      let handlerCompleted = false;

      const handler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        handlerCompleted = true;
      });

      eventBus.on('test.event', 'test-plugin', handler);

      const startTime = Date.now();
      await eventBus.emit('test.event', 'sender', {});
      const emitDuration = Date.now() - startTime;

      expect(emitDuration).toBeLessThan(10);
      expect(handlerCompleted).toBe(false);

      await waitForEventProcessing(100);

      expect(handlerCompleted).toBe(true);
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Payload Transmission', () => {
    it('shouldComplete传递复杂Objectpayload', async () => {
      // ===== Description =====
      // =================

      const complexPayload = {
        user: {
          id: '123',
          name: 'John Doe',
          email: 'john@example.com',
          profile: {
            age: 30,
            city: 'New York',
          },
        },
        metadata: {
          timestamp: new Date().toISOString(),
          source: 'api',
        },
        tags: ['new-user', 'premium'],
      };

      const receivedData: Array<{
        payload: unknown;
        metadata: EventMetadata;
        timestamp: Date;
      }> = [];
      const handler = createRecordingHandler(receivedData);

      eventBus.on('user.registered', 'test-plugin', handler);

      await eventBus.emit('user.registered', 'auth', complexPayload);
      await waitForEventProcessing(100);

      expect(receivedData.length).toBe(1);
      expect(receivedData[0].payload).toEqual(complexPayload);
    });

    it('shouldSupportsArrayTypeofpayload', async () => {
      // ===== Description =====
      // =================

      const arrayPayload = [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' },
        { id: 3, name: 'Item 3' },
      ];

      const receivedData: Array<{
        payload: unknown;
        metadata: EventMetadata;
        timestamp: Date;
      }> = [];
      const handler = createRecordingHandler(receivedData);

      eventBus.on('items.updated', 'test-plugin', handler);

      await eventBus.emit('items.updated', 'item-service', arrayPayload);
      await waitForEventProcessing(100);

      expect(receivedData[0].payload).toEqual(arrayPayload);
    });

    it('shouldSupportsRawTypepayload', async () => {
      // ===== Description =====
      // =================

      const receivedData: Array<{
        payload: unknown;
        metadata: EventMetadata;
        timestamp: Date;
      }> = [];
      const handler = createRecordingHandler(receivedData);

      eventBus.on('test.event', 'test-plugin', handler);

      await eventBus.emit('test.event', 'sender', 'simple string');
      await waitForEventProcessing(50);

      expect(receivedData[0].payload).toBe('simple string');

      await eventBus.emit('test.event', 'sender', 42);
      await waitForEventProcessing(50);

      expect(receivedData[1].payload).toBe(42);

      await eventBus.emit('test.event', 'sender', true);
      await waitForEventProcessing(50);

      expect(receivedData[2].payload).toBe(true);
    });

    it('AllSubscription者should接收to相同ofpayload', async () => {
      // ===== Description =====
      // =================

      const receivedData: Array<{ handlerId: string; payload: unknown }> = [];

      const createRecordingHandler = (id: string) => {
        return vi.fn(async (payload: unknown) => {
          receivedData.push({ handlerId: id, payload });
        });
      };

      eventBus.on('test.event', 'plugin-a', createRecordingHandler('A'));
      eventBus.on('test.event', 'plugin-b', createRecordingHandler('B'));
      eventBus.on('test.event', 'plugin-c', createRecordingHandler('C'));

      const payload = { value: 'test-data', id: 123 };

      await eventBus.emit('test.event', 'sender', payload);
      await waitForEventProcessing(100);

      expect(receivedData.length).toBe(3);
      receivedData.forEach((data) => {
        expect(data.payload).toEqual(payload);
      });
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Metadata Construction', () => {
    it('should自动构建Completeofmetadata', async () => {
      // ===== Description =====
      // =================

      const receivedData: Array<{
        payload: unknown;
        metadata: EventMetadata;
        timestamp: Date;
      }> = [];
      const handler = createRecordingHandler(receivedData);

      eventBus.on('test.event', 'test-plugin', handler);

      const beforeEmit = new Date();
      await eventBus.emit('test.event', 'sender-plugin', { data: 'test' });
      const afterEmit = new Date();

      await waitForEventProcessing(100);

      expect(receivedData.length).toBe(1);

      const metadata = receivedData[0].metadata;

      // ValidationmetadataField
      expect(metadata.emitterId).toBe('sender-plugin');
      expect(metadata.timestamp).toBeInstanceOf(Date);

      expect(metadata.timestamp.getTime()).toBeGreaterThanOrEqual(beforeEmit.getTime());
      expect(metadata.timestamp.getTime()).toBeLessThanOrEqual(afterEmit.getTime());
    });

    it('AllSubscription者should接收to相同ofmetadata', async () => {
      // ===== Description =====
      // =================

      const receivedData: Array<{ handlerId: string; metadata: EventMetadata }> = [];

      const createRecordingHandler = (id: string) => {
        return vi.fn(async (payload: unknown, metadata: EventMetadata) => {
          receivedData.push({ handlerId: id, metadata });
        });
      };

      eventBus.on('test.event', 'plugin-a', createRecordingHandler('A'));
      eventBus.on('test.event', 'plugin-b', createRecordingHandler('B'));

      await eventBus.emit('test.event', 'emitter-plugin', {});
      await waitForEventProcessing(100);

      expect(receivedData.length).toBe(2);

      const metadata1 = receivedData[0].metadata;
      const metadata2 = receivedData[1].metadata;

      expect(metadata1.emitterId).toBe(metadata2.emitterId);
      if (metadata1.timestamp instanceof Date && metadata2.timestamp instanceof Date) {
        expect(metadata1.timestamp.getTime()).toBe(metadata2.timestamp.getTime());
      }
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('No Subscribers Scenario', () => {
    it('Publish没有Subscription者ofEventshouldSuccessBack', async () => {
      // ===== Description =====
      // =================

      await expect(eventBus.emit('nonexistent.event', 'sender', {})).resolves.not.toThrow();
    });

    it('CancelAllSubscription后PublishEventshould正常', async () => {
      // ===== Description =====
      // =================

      const handler = createMockEventHandler();

      // Subscription
      eventBus.on('test.event', 'test-plugin', handler);

      // CancelSubscription
      eventBus.off('test.event', 'test-plugin');

      // PublishEvent
      await expect(eventBus.emit('test.event', 'sender', {})).resolves.not.toThrow();

      await waitForEventProcessing(100);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Input Validation', () => {
    it('should拒绝空ofEvent name', async () => {
      // ===== Description =====
      // =================

      await expect(eventBus.emit('', 'sender', {})).rejects.toThrow();
    });

    it('should拒绝空ofPublish者ID', async () => {
      // ===== Description =====
      // =================

      await expect(eventBus.emit('test.event', '', {})).rejects.toThrow();
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Concurrent Publishing', () => {
    it('shouldSupports同whenPublishmultipleEvent', async () => {
      // ===== Description =====
      // =================

      const handler = createMockEventHandler();
      eventBus.on('test.event', 'test-plugin', handler);

      // whenPublish5Event
      await Promise.all([
        eventBus.emit('test.event', 'sender', { id: 1 }),
        eventBus.emit('test.event', 'sender', { id: 2 }),
        eventBus.emit('test.event', 'sender', { id: 3 }),
        eventBus.emit('test.event', 'sender', { id: 4 }),
        eventBus.emit('test.event', 'sender', { id: 5 }),
      ]);

      await waitForEventProcessing(100);

      expect(handler).toHaveBeenCalledTimes(5);
    });

    it('并发Publish不shouldcauseEventlose', async () => {
      // ===== Description =====
      // =================

      const receivedIds: number[] = [];

      const handler = vi.fn(async (payload: unknown) => {
        if (payload && typeof payload === 'object' && 'id' in payload) {
          receivedIds.push((payload as { id: number }).id);
        }
      });

      eventBus.on('test.event', 'test-plugin', handler);

      // Publish10Event
      const emitPromises = [];
      for (let i = 1; i <= 10; i++) {
        emitPromises.push(eventBus.emit('test.event', 'sender', { id: i }));
      }

      await Promise.all(emitPromises);
      await waitForEventProcessing(200);

      expect(receivedIds.length).toBe(10);

      const uniqueIds = new Set(receivedIds);
      expect(uniqueIds.size).toBe(10);

      for (let i = 1; i <= 10; i++) {
        expect(receivedIds).toContain(i);
      }
    });
  });
});
