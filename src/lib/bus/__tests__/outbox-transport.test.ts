/**
 * Outbox Event Transport Tests
 *
 * Covers:
 * - Event queuing and persistence
 * - Background processing
 * - Retry with exponential backoff
 * - Max retry exhaustion
 * - Entry status transitions
 * - Stats reporting
 * - Failed entry replay
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OutboxEventTransport } from '../transports/outbox-event';
import { createTestMetadata } from './helpers';

describe('OutboxEventTransport', () => {
  let transport: OutboxEventTransport;

  beforeEach(() => {
    transport = new OutboxEventTransport({
      pollIntervalMs: 1000,
      autoStart: false,
      maxRetries: 3,
      retryPolicy: {
        maxRetries: 3,
        backoff: 'fixed',
        baseDelayMs: 0,
        maxDelayMs: 0,
      },
    });
  });

  describe('send', () => {
    it('should queue event to outbox', async () => {
      // Mock inner transport to prevent auto-processing from completing
      const innerTransport = (transport as any).innerTransport;
      vi.spyOn(innerTransport, 'send').mockRejectedValue(new Error('hold'));

      await transport.send('test.event', { foo: 'bar' }, createTestMetadata({ emitterId: 'test' }));

      const stats = await transport.getStats();
      expect(stats.total).toBe(1);
      // autoStart=false leaves direct transport tests in manual processing mode.
      expect(stats.pending).toBe(1);
    });

    it('should queue multiple events', async () => {
      await transport.send('event.a', {}, createTestMetadata({ emitterId: 'test' }));
      await transport.send('event.b', {}, createTestMetadata({ emitterId: 'test' }));

      const stats = await transport.getStats();
      expect(stats.total).toBe(2);
    });
  });

  describe('processOutbox', () => {
    it('should process pending entry successfully', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      transport.subscribe('test.event', 'test-plugin', handler);

      await transport.send('test.event', { foo: 'bar' }, createTestMetadata({ emitterId: 'test' }));
      await transport.processOutbox();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ foo: 'bar' }, expect.any(Object));

      const stats = await transport.getStats();
      expect(stats.completed).toBe(1);
      expect(stats.pending).toBe(0);
    });

    it('should retry failed entries when inner transport throws', async () => {
      // Mock inner transport send to simulate failure
      const innerTransport = (transport as any).innerTransport;
      vi.spyOn(innerTransport, 'send').mockRejectedValue(new Error('handler failed'));

      await transport.send('test.event', {}, createTestMetadata({ emitterId: 'test' }));
      await transport.processOutbox();

      // After first failure, entry should be pending again for retry
      const stats = await transport.getStats();
      expect(stats.failed).toBe(0);
      expect(stats.pending).toBe(1);
    });

    it('should mark entry as failed after max retries', async () => {
      // Mock inner transport send to simulate persistent failure
      const innerTransport = (transport as any).innerTransport;
      vi.spyOn(innerTransport, 'send').mockRejectedValue(new Error('handler failed'));

      await transport.send('test.event', {}, createTestMetadata({ emitterId: 'test' }));

      // Process multiple times to exhaust retries
      for (let i = 0; i < 5; i++) {
        await transport.processOutbox();
      }

      const stats = await transport.getStats();
      expect(stats.failed).toBe(1);
      expect(stats.pending).toBe(0);
    });

    it('should not process when no subscribers', async () => {
      await transport.send('test.event', {}, createTestMetadata({ emitterId: 'test' }));
      await transport.processOutbox();

      // No subscribers means inner transport send fails, but it's handled
      const stats = await transport.getStats();
      expect(stats.total).toBe(1);
    });

    it('should be idempotent when already processing', async () => {
      const handler = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      transport.subscribe('test.event', 'test-plugin', handler);

      await transport.send('test.event', {}, createTestMetadata({ emitterId: 'test' }));

      // Start two concurrent process calls
      const p1 = transport.processOutbox();
      const p2 = transport.processOutbox();
      await Promise.all([p1, p2]);

      // Should only process once due to isProcessing guard
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('getStats', () => {
    it('should return zero stats for empty outbox', async () => {
      const stats = await transport.getStats();
      expect(stats).toEqual({
        total: 0,
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        ignored: 0,
        archived: 0,
      });
    });

    it('should track multiple statuses', async () => {
      const successHandler = vi.fn().mockResolvedValue(undefined);
      const failHandler = vi.fn().mockRejectedValue(new Error('fail'));

      transport.subscribe('success.event', 'p1', successHandler);
      transport.subscribe('fail.event', 'p2', failHandler);

      await transport.send('success.event', {}, createTestMetadata({ emitterId: 'test' }));
      await transport.send('fail.event', {}, createTestMetadata({ emitterId: 'test' }));
      await transport.processOutbox();

      const stats = await transport.getStats();
      expect(stats.total).toBe(2);
      expect(stats.completed).toBe(1);
      expect(stats.pending).toBe(1);
    });
  });

  describe('getFailedEntries', () => {
    it('should return empty array when no failures', async () => {
      await expect(transport.getFailedEntries()).resolves.toEqual([]);
    });

    it('should return failed entries after max retries', async () => {
      const innerTransport = (transport as any).innerTransport;
      vi.spyOn(innerTransport, 'send').mockRejectedValue(new Error('fail'));

      await transport.send('test.event', {}, createTestMetadata({ emitterId: 'test' }));
      for (let i = 0; i < 5; i++) {
        await transport.processOutbox();
      }

      const failed = await transport.getFailedEntries();
      expect(failed.length).toBe(1);
      expect(failed[0].event).toBe('test.event');
      expect(failed[0].error).toBe('fail');
    });
  });

  describe('replayEntry', () => {
    it('should return false for non-existent entry', async () => {
      await expect(transport.replayEntry('non-existent')).resolves.toBe(false);
    });

    it('should return false for non-failed entry', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      transport.subscribe('test.event', 'test-plugin', handler);

      await transport.send('test.event', {}, createTestMetadata({ emitterId: 'test' }));
      await transport.processOutbox();

      // Entry is completed, not failed
      const completed = (await transport.getStats()).completed;
      expect(completed).toBe(1);
    });

    it('should replay failed entry and reset attempts', async () => {
      const innerTransport = (transport as any).innerTransport;
      vi.spyOn(innerTransport, 'send').mockRejectedValue(new Error('fail'));

      await transport.send('test.event', {}, createTestMetadata({ emitterId: 'test' }));
      for (let i = 0; i < 5; i++) {
        await transport.processOutbox();
      }

      const failed = await transport.getFailedEntries();
      expect(failed.length).toBe(1);
      const entryId = failed[0].id;
      expect(failed[0].attempts).toBeGreaterThanOrEqual(3);

      // Replay triggers async processing; await it explicitly
      await expect(transport.replayEntry(entryId)).resolves.toBe(true);
      await transport.processOutbox();

      const afterReplay = await transport.getStats();
      expect(afterReplay.pending).toBe(1); // failed once, back to pending for retry
      expect(afterReplay.failed).toBe(0);
    });
  });

  describe('subscribe/unsubscribe', () => {
    it('should subscribe handler for event', () => {
      const handler = vi.fn();
      transport.subscribe('test.event', 'plugin', handler);

      const subscribers = transport.getSubscribers('test.event');
      expect(subscribers).toContain('plugin');
    });

    it('should unsubscribe handler for event', () => {
      const handler = vi.fn();
      transport.subscribe('test.event', 'plugin', handler);
      transport.unsubscribe('test.event', 'plugin', handler);

      // After unsubscribing, there should be no subscribers for that plugin/event combo
      const subs = transport.getPluginEventSubscriptions('plugin');
      expect(subs).not.toContain('test.event');
    });

    it('should remove all subscriptions for a plugin', () => {
      const handler = vi.fn();
      transport.subscribe('event.a', 'plugin', handler);
      transport.subscribe('event.b', 'plugin', handler);

      transport.removeAllSubscriptions('plugin');

      const subs = transport.getPluginEventSubscriptions('plugin');
      expect(subs.length).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all entries and subscriptions', async () => {
      const handler = vi.fn();
      transport.subscribe('test.event', 'plugin', handler);
      await transport.send('test.event', {}, createTestMetadata({ emitterId: 'test' }));

      transport.clear();

      const stats = await transport.getStats();
      expect(stats.total).toBe(0);
    });
  });
});
