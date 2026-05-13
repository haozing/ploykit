/**
 *
 *
 *
 * @see docs/testing/hooks-system-tests.md
 * @see docs/testing/event-bus-tests.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UnifiedHookSystem } from '../unified-system';
import { EventBus } from '../../event-bus';
import { createMockEventHandler, waitForEventProcessing } from '../../__tests__/helpers';

// ===== Mock HookContextBuilder =====
vi.mock('../context', () => ({
  HookContextBuilder: {
    build: vi.fn(async (pluginId, hookName, environment, payload) => ({
      plugin: {
        id: pluginId,
        contract: { id: pluginId, name: pluginId, version: '1.0.0' },
        db: {},
        kv: {},
        cache: {},
        logger: {},
        config: {},
      },
      hook: {
        name: hookName,
        type: 'render',
        trigger: `hook:${hookName}`,
      },
      environment: {
        ...environment,
        timestamp: new Date(),
      },
      payload,
    })),
  },
}));

describe('Error Isolation - Comprehensive Tests', () => {
  let hookSystem: UnifiedHookSystem;
  let eventBus: EventBus;

  beforeEach(() => {
    hookSystem = new UnifiedHookSystem();
    eventBus = new EventBus();
  });

  afterEach(() => {
    hookSystem.clear();
    eventBus.clear();
  });

  // ==========================================================================
  // ==========================================================================

  describe('Hooks System Error Isolation', () => {
    it('一handlerThrowError不should影响Otherhandlers', async () => {
      // ===== Description =====
      // =================

      const successHandler1 = vi.fn(async () => ({ result: 'success-1' }));
      const failingHandler = vi.fn(async () => {
        throw new Error('Handler B failed');
      });
      const successHandler2 = vi.fn(async () => ({ result: 'success-2' }));

      hookSystem.register('plugin-a', 'onRenderHead', successHandler1, 10);
      hookSystem.register('plugin-b', 'onRenderHead', failingHandler, 20);
      hookSystem.register('plugin-c', 'onRenderHead', successHandler2, 30);

      const results = await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );

      expect(successHandler1).toHaveBeenCalled();
      expect(failingHandler).toHaveBeenCalled();
      expect(successHandler2).toHaveBeenCalled();

      expect(results.length).toBe(3);
      expect(results[0].success).toBe(true);
      expect(results[0].data).toEqual({ result: 'success-1' });
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe('Handler B failed');
      expect(results[2].success).toBe(true);
      expect(results[2].data).toEqual({ result: 'success-2' });
    });

    it('multiplehandlerFailed不should影响Successofhandlers', async () => {
      // ===== Description =====
      // =================

      const successHandler = vi.fn(async () => ({ status: 'ok' }));
      const failingHandler1 = vi.fn(async () => {
        throw new Error('Error 1');
      });
      const failingHandler2 = vi.fn(async () => {
        throw new Error('Error 2');
      });
      const failingHandler3 = vi.fn(async () => {
        throw new Error('Error 3');
      });

      hookSystem.register('good-plugin', 'onRenderHead', successHandler, 10);
      hookSystem.register('bad-plugin-1', 'onRenderHead', failingHandler1, 20);
      hookSystem.register('bad-plugin-2', 'onRenderHead', failingHandler2, 30);
      hookSystem.register('bad-plugin-3', 'onRenderHead', failingHandler3, 40);

      const results = await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );

      // ValidationResult
      expect(results.length).toBe(4);

      const successResults = results.filter((r) => r.success);
      const failedResults = results.filter((r) => !r.success);

      expect(successResults.length).toBe(1);
      expect(failedResults.length).toBe(3);
      expect(successResults[0].data).toEqual({ status: 'ok' });
    });

    it('同步Errorshouldbe正确catch', async () => {
      // ===== Description =====
      // =================

      const syncErrorHandler = vi.fn(async () => {
        throw new Error('Synchronous error');
      });

      hookSystem.register('error-plugin', 'onRenderHead', syncErrorHandler, 50);

      const results = await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('Synchronous error');
      expect(results[0].pluginId).toBe('error-plugin');
    });

    it('AsyncError（Promise rejection）shouldbe正确catch', async () => {
      // ===== Description =====
      // =================

      const asyncErrorHandler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error('Async error after delay');
      });

      hookSystem.register('async-error-plugin', 'onRenderHead', asyncErrorHandler, 50);

      const results = await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('Async error after delay');
    });

    it('ErrorObjectshould包含CompleteofError信息', async () => {
      // ===== Description =====
      // =================

      const errorHandler = vi.fn(async () => {
        throw new Error('Detailed error message');
      });

      hookSystem.register('test-plugin', 'onRenderHead', errorHandler, 50);

      const results = await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );

      const failedResult = results[0];

      expect(failedResult.success).toBe(false);
      expect(failedResult.error).toBe('Detailed error message');
      expect(failedResult.pluginId).toBe('test-plugin');
      expect(failedResult.duration).toBeGreaterThanOrEqual(0);
      expect(failedResult.executedAt).toBeInstanceOf(Date);
    });

    it('handlerinofTypeErrorshouldbecatch', async () => {
      // ===== Description =====
      // =================

      const typeErrorHandler = vi.fn(async () => {
        const obj: unknown = null;
        return (obj as Record<string, unknown>).someProperty; // ThrowTypeError
      });

      hookSystem.register('buggy-plugin', 'onRenderHead', typeErrorHandler, 50);

      const results = await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('null');
    });

    it('SystematError后should能Continue正常工作', async () => {
      // ===== Description =====
      // =================

      const failingHandler = vi.fn(async () => {
        throw new Error('First execution fails');
      });

      const successHandler = vi.fn(async () => ({ status: 'success' }));

      hookSystem.register('test-plugin', 'onRenderHead', failingHandler, 50);

      const results1 = await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );

      expect(results1[0].success).toBe(false);

      hookSystem.unregister('test-plugin');
      hookSystem.register('test-plugin', 'onRenderHead', successHandler, 50);

      const results2 = await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );

      expect(results2[0].success).toBe(true);
      expect(results2[0].data).toEqual({ status: 'success' });
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Event Bus Error Isolation', () => {
    it('一Subscription者Failed不should影响OtherSubscription者', async () => {
      // ===== Description =====
      // =================

      const successHandler1 = createMockEventHandler();
      const failingHandler = vi.fn(async () => {
        throw new Error('Subscriber failed');
      });
      const successHandler2 = createMockEventHandler();

      eventBus.on('test.event', 'plugin-a', successHandler1);
      eventBus.on('test.event', 'plugin-b', failingHandler);
      eventBus.on('test.event', 'plugin-c', successHandler2);

      await expect(eventBus.emit('test.event', 'sender', { data: 'test' })).resolves.not.toThrow();

      await waitForEventProcessing(100);

      expect(successHandler1).toHaveBeenCalled();
      expect(failingHandler).toHaveBeenCalled();
      expect(successHandler2).toHaveBeenCalled();
    });

    it('multipleSubscription者Failed不should影响SuccessofSubscription者', async () => {
      // ===== Description =====
      // =================

      let successfulCalls = 0;
      let failedCalls = 0;

      const successHandler = vi.fn(async () => {
        successfulCalls++;
      });

      const failingHandler1 = vi.fn(async () => {
        failedCalls++;
        throw new Error('Subscriber 1 failed');
      });

      const failingHandler2 = vi.fn(async () => {
        failedCalls++;
        throw new Error('Subscriber 2 failed');
      });

      eventBus.on('test.event', 'good-plugin', successHandler);
      eventBus.on('test.event', 'bad-plugin-1', failingHandler1);
      eventBus.on('test.event', 'bad-plugin-2', failingHandler2);

      await eventBus.emit('test.event', 'sender', {});
      await waitForEventProcessing(100);

      expect(successfulCalls).toBe(1);
      expect(failedCalls).toBe(2);
    });

    it('Subscription者inof同步Errorshouldbecatch', async () => {
      // ===== Description =====
      // =================

      const syncErrorHandler = vi.fn(async () => {
        throw new Error('Sync error in subscriber');
      });

      eventBus.on('test.event', 'error-plugin', syncErrorHandler);

      await expect(eventBus.emit('test.event', 'sender', {})).resolves.not.toThrow();

      await waitForEventProcessing(100);

      expect(syncErrorHandler).toHaveBeenCalled();
    });

    it('Subscription者inofAsyncErrorshouldbecatch', async () => {
      // ===== Description =====
      // =================

      const asyncErrorHandler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw new Error('Async error in subscriber');
      });

      eventBus.on('test.event', 'async-error-plugin', asyncErrorHandler);

      await eventBus.emit('test.event', 'sender', {});
      await waitForEventProcessing(100);

      expect(asyncErrorHandler).toHaveBeenCalled();
    });

    it('Publish者不shouldbeSubscription者ofError阻塞', async () => {
      // ===== Description =====
      // =================

      const slowFailingHandler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        throw new Error('Slow subscriber failed');
      });

      eventBus.on('test.event', 'slow-plugin', slowFailingHandler);

      const startTime = Date.now();
      await eventBus.emit('test.event', 'sender', {});
      const emitDuration = Date.now() - startTime;

      expect(emitDuration).toBeLessThan(20);

      await waitForEventProcessing(150);

      expect(slowFailingHandler).toHaveBeenCalled();
    });

    it('SystematSubscription者Error后should能ContinuePublishEvent', async () => {
      // ===== Description =====
      // =================

      let callCount = 0;

      const sometimesFailingHandler = vi.fn(async (_payload: unknown) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Second call fails');
        }
        // Return void to match EventHandler type
      });

      eventBus.on('test.event', 'test-plugin', sometimesFailingHandler);

      // timesPublish - Success
      await eventBus.emit('test.event', 'sender', { attempt: 1 });
      await waitForEventProcessing(50);

      // timesPublish - Failed
      await eventBus.emit('test.event', 'sender', { attempt: 2 });
      await waitForEventProcessing(50);

      await eventBus.emit('test.event', 'sender', { attempt: 3 });
      await waitForEventProcessing(50);

      expect(sometimesFailingHandler).toHaveBeenCalledTimes(3);
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Various Error Types', () => {
    it('TypeErrorshouldbe正确处理', async () => {
      // ===== Description =====
      // =================

      const typeErrorHandler = vi.fn(async () => {
        const obj: unknown = undefined;
        (obj as Record<string, () => void>).nonexistentMethod(); // TypeError
      });

      hookSystem.register('buggy-plugin', 'onRenderHead', typeErrorHandler, 50);

      const results = await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('undefined');
    });

    it('ReferenceErrorshouldbe正确处理', async () => {
      // ===== Description =====
      // =================

      const referenceErrorHandler = vi.fn(async () => {
        // @ts-expect-error - Intentionally referencing undefined variable to test ReferenceError handling
        return undefinedVariable;
      });

      hookSystem.register('reference-error-plugin', 'onRenderHead', referenceErrorHandler, 50);

      const results = await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBeDefined();
    });

    it('customErrorObjectshouldbe正确处理', async () => {
      // ===== Description =====
      // =================

      class CustomPluginError extends Error {
        constructor(
          message: string,
          public code: string
        ) {
          super(message);
          this.name = 'CustomPluginError';
        }
      }

      const customErrorHandler = vi.fn(async () => {
        throw new CustomPluginError('Something went wrong', 'PLUGIN_ERROR_001');
      });

      hookSystem.register('custom-error-plugin', 'onRenderHead', customErrorHandler, 50);

      const results = await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('Something went wrong');
    });

    it('Throw非ErrorObjectshouldbe处理', async () => {
      // ===== Description =====
      // =================

      const stringErrorHandler = vi.fn(async () => {
        throw 'Simple string error';
      });

      const numberErrorHandler = vi.fn(async () => {
        throw 404;
      });

      hookSystem.register('string-error', 'onRenderHead', stringErrorHandler, 10);
      hookSystem.register('number-error', 'onRenderHead', numberErrorHandler, 20);

      const results = await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('Simple string error');
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe('404');
    });

    it('Promise.rejectshouldbe处理', async () => {
      // ===== Description =====
      // =================

      const rejectedPromiseHandler = vi.fn(async () => {
        return Promise.reject(new Error('Promise rejected'));
      });

      hookSystem.register('reject-plugin', 'onRenderHead', rejectedPromiseHandler, 50);

      const results = await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('Promise rejected');
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Partial Failure Scenarios', () => {
    it('50%Success率of场景should正确处理', async () => {
      // ===== Description =====
      // =================

      const handlers = [];
      for (let i = 0; i < 10; i++) {
        const handler = vi.fn(async () => {
          if (i % 2 === 0) {
            return { index: i, status: 'success' };
          } else {
            throw new Error(`Handler ${i} failed`);
          }
        });
        handlers.push(handler);
        hookSystem.register(`plugin-${i}`, 'onRenderHead', handler, i * 10);
      }

      const results = await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );

      expect(results.length).toBe(10);
      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      expect(successCount).toBe(5);
      expect(failCount).toBe(5);
    });

    it('大多数Failed但有少数Successof场景', async () => {
      // ===== Description =====
      // =================

      const handlers = [];
      for (let i = 0; i < 10; i++) {
        const handler = vi.fn(async () => {
          if (i < 9) {
            throw new Error(`Plugin ${i} error`);
          }
          return { survivor: true };
        });
        handlers.push(handler);
        hookSystem.register(`plugin-${i}`, 'onRenderHead', handler, i * 10);
      }

      const results = await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );

      const successResults = results.filter((r) => r.success);
      expect(successResults.length).toBe(1);
      expect(successResults[0].data).toEqual({ survivor: true });
    });

    it('executeAndMergeshouldFilterFailedofResult', async () => {
      // ===== Description =====
      // BackSuccessofResult
      // =================

      const successHandler1 = vi.fn(async () => [{ id: 1 }, { id: 2 }]);
      const failingHandler = vi.fn(async () => {
        throw new Error('Failed');
      });
      const successHandler2 = vi.fn(async () => [{ id: 3 }, { id: 4 }]);

      hookSystem.register('plugin-a', 'onRenderHead', successHandler1, 10);
      hookSystem.register('plugin-b', 'onRenderHead', failingHandler, 20);
      hookSystem.register('plugin-c', 'onRenderHead', successHandler2, 30);

      const merged = await hookSystem.executeAndMerge(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );

      expect(merged).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Error Recovery and Fault Tolerance', () => {
    it('连续ofError不should破坏SystemStatus', async () => {
      // ===== Description =====
      // =================

      const alwaysFailingHandler = vi.fn(async () => {
        throw new Error('Always fails');
      });

      hookSystem.register('failing-plugin', 'onRenderHead', alwaysFailingHandler, 50);

      for (let i = 0; i < 10; i++) {
        const results = await hookSystem.execute(
          'onRenderHead',
          { userId: 'user-1' },
          { url: '/test', pathname: '/test' }
        );
        expect(results[0].success).toBe(false);
      }

      const successHandler = vi.fn(async () => ({ recovered: true }));
      hookSystem.register('recovery-plugin', 'onRenderHead', successHandler, 40);

      const finalResults = await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );

      expect(finalResults.length).toBe(2);
      const successResult = finalResults.find((r) => r.success);
      expect(successResult?.data).toEqual({ recovered: true });
    });

    it('Error后of统计信息should准确', async () => {
      // ===== Description =====
      // =================

      const successHandler = vi.fn(async () => ({ ok: true }));
      const failingHandler = vi.fn(async () => {
        throw new Error('Failed');
      });

      hookSystem.register('good', 'onRenderHead', successHandler, 10);
      hookSystem.register('bad', 'onRenderHead', failingHandler, 20);

      const results = await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );

      //
      const successCount = results.filter((r) => r.success).length;
      const failedCount = results.filter((r) => !r.success).length;
      const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

      expect(successCount).toBe(1);
      expect(failedCount).toBe(1);
      expect(totalDuration).toBeGreaterThanOrEqual(0);
    });

    it('并发Error处理不shouldcause竞态件', async () => {
      // ===== Description =====
      // =================

      const sometimesFailingHandler = vi.fn(async () => {
        const random = Math.random();
        if (random < 0.5) {
          throw new Error('Random failure');
        }
        return { success: true };
      });

      hookSystem.register('random-plugin', 'onRenderHead', sometimesFailingHandler, 50);

      // 20times
      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          hookSystem.execute(
            'onRenderHead',
            { userId: 'user-1' },
            { url: '/test', pathname: '/test' }
          )
        );
      }

      const allResults = await Promise.all(promises);

      expect(allResults.length).toBe(20);
      allResults.forEach((results) => {
        expect(results.length).toBe(1);
      });

      expect(sometimesFailingHandler).toHaveBeenCalledTimes(20);
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Event Bus Specific Error Scenarios', () => {
    it('并发PublishwhenSubscription者Errorshouldbe独立处理', async () => {
      // ===== Description =====
      // =================

      const handler = vi.fn(async (_payload: unknown) => {
        const payload = _payload as { id: number; shouldFail: boolean };
        if (payload.shouldFail) {
          throw new Error('Handler failed for this event');
        }
      });

      eventBus.on('test.event', 'test-plugin', handler);

      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          eventBus.emit('test.event', 'sender', {
            id: i,
            shouldFail: i % 2 === 0,
          })
        );
      }

      await expect(Promise.all(promises)).resolves.not.toThrow();

      await waitForEventProcessing(100);

      expect(handler).toHaveBeenCalledTimes(10);
    });

    it('Subscription者inof长Time操作不should阻塞emitBack', async () => {
      // ===== Description =====
      // asEvent BusYesAsyncof）
      // =================

      let handlerCompleted = false;

      const longRunningHandler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        handlerCompleted = true;
      });

      eventBus.on('test.event', 'slow-plugin', longRunningHandler);

      const startTime = Date.now();
      await eventBus.emit('test.event', 'sender', {});
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(20);

      expect(handlerCompleted).toBe(false);

      await waitForEventProcessing(150);

      expect(handlerCompleted).toBe(true);
      expect(longRunningHandler).toHaveBeenCalled();
    });

    it('AllSubscription者都Failedof场景', async () => {
      // ===== Description =====
      // =================

      const failingHandler1 = vi.fn(async () => {
        throw new Error('Handler 1 failed');
      });
      const failingHandler2 = vi.fn(async () => {
        throw new Error('Handler 2 failed');
      });
      const failingHandler3 = vi.fn(async () => {
        throw new Error('Handler 3 failed');
      });

      eventBus.on('test.event', 'plugin-1', failingHandler1);
      eventBus.on('test.event', 'plugin-2', failingHandler2);
      eventBus.on('test.event', 'plugin-3', failingHandler3);

      await expect(eventBus.emit('test.event', 'sender', {})).resolves.not.toThrow();

      await waitForEventProcessing(100);

      expect(failingHandler1).toHaveBeenCalled();
      expect(failingHandler2).toHaveBeenCalled();
      expect(failingHandler3).toHaveBeenCalled();
    });
  });
});
