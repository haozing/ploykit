/**
 *
 *
 *
 *
 * @see docs/testing/hooks-system-tests.md
 * @see docs/testing/event-bus-tests.md
 * @see docs/architecture/single-user-migration.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UnifiedHookSystem } from '../unified-system';
import { EventBus } from '../../event-bus';
import { createMockHandler } from './helpers';
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

describe('user Isolation - Comprehensive Tests', () => {
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

  describe('Hooks System user Isolation', () => {
    it('不同user执行相同hookshould接收独立ofcontext', async () => {
      // ===== Description =====
      // =================

      const receiveduserIds: string[] = [];

      const handler = vi.fn(async (context) => {
        receiveduserIds.push(context.environment.userId);
        return { userId: context.environment.userId };
      });

      hookSystem.register('test-plugin', 'onRenderHead', handler, 50);

      const results1 = await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );

      const results2 = await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-2' },
        { url: '/test', pathname: '/test' }
      );

      expect(results1[0].data).toEqual({ userId: 'user-1' });
      expect(results2[0].data).toEqual({ userId: 'user-2' });
      expect(receiveduserIds).toEqual(['user-1', 'user-2']);
    });

    it('userAofhook执行不should影响userBofhookStatus', async () => {
      // ===== Description =====
      // =================

      const userCallCounts = new Map<string, number>();

      const handler = vi.fn(async (context) => {
        const userId = context.environment.userId || 'anonymous';
        const currentCount = userCallCounts.get(userId) || 0;
        userCallCounts.set(userId, currentCount + 1);
        return { count: userCallCounts.get(userId) };
      });

      hookSystem.register('test-plugin', 'onRenderHead', handler, 50);

      await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );
      await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );
      await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );

      await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-2' },
        { url: '/test', pathname: '/test' }
      );

      expect(userCallCounts.get('user-1')).toBe(3);
      expect(userCallCounts.get('user-2')).toBe(1);
    });

    it('不同user可by独立Configurationhookof优先级', async () => {
      // ===== Description =====
      // =================

      const handlerA = vi.fn(async () => ({ plugin: 'A' }));
      const handlerB = vi.fn(async () => ({ plugin: 'B' }));

      hookSystem.register('plugin-a', 'onRenderHead', handlerA, 10);
      hookSystem.register('plugin-b', 'onRenderHead', handlerB, 20);

      const results = await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1' },
        { url: '/test', pathname: '/test' }
      );

      expect((results[0].data as { plugin: string }).plugin).toBe('A');
      expect((results[1].data as { plugin: string }).plugin).toBe('B');
    });

    it('Alluser共享相同ofhookRegisterTable', () => {
      // ===== Description =====
      // =================

      const handler = createMockHandler();
      hookSystem.register('test-plugin', 'onRenderHead', handler, 50);

      expect(hookSystem.hasHook('test-plugin', 'onRenderHead')).toBe(true);
    });

    it('不同userRequestof统计信息should反映GlobalStatus', () => {
      // ===== Description =====
      // =================

      hookSystem.register('plugin-a', 'onRenderHead', createMockHandler(), 50);
      hookSystem.register('plugin-b', 'onBeforeHandle', createMockHandler(), 50);
      hookSystem.registerFromContract('plugin-c', ['onInstall'], 100);

      const stats = hookSystem.getStats();
      expect(stats.preLoaded).toBe(2);
      expect(stats.lazyLoad).toBe(0);
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Event Bus user Isolation', () => {
    it('Eventshouldat单user范围内处理', async () => {
      // ===== Description =====
      // =================

      const handler = createMockEventHandler();

      eventBus.on('user.created', 'plugin', handler);

      // PublishEvent
      await eventBus.emit('user.created', 'auth', { userId: '123' });
      await waitForEventProcessing(100);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('不同user可bySubscription相同Event但接收自己ofData', async () => {
      // ===== Description =====
      // =================

      const receivedData: unknown[] = [];

      const handler = vi.fn(async (_payload: unknown) => {
        const payload = _payload as { orderId: string; userId: string; amount: number };
        receivedData.push(payload);
      });

      eventBus.on('order.created', 'plugin', handler);

      // Publishuser1ofOrderEvent
      await eventBus.emit('order.created', 'order-service', {
        orderId: 'ORDER-U1-001',
        userId: 'user-1',
        amount: 100,
      });

      // Publishuser2ofOrderEvent
      await eventBus.emit('order.created', 'order-service', {
        orderId: 'ORDER-U2-001',
        userId: 'user-2',
        amount: 200,
      });

      await waitForEventProcessing(100);

      expect(receivedData.length).toBe(2);
      expect((receivedData[0] as { userId: string }).userId).toBe('user-1');
      expect((receivedData[1] as { userId: string }).userId).toBe('user-2');
    });

    it('CancelSubscription影响Alluser', async () => {
      // ===== Description =====
      // =================

      const handler = createMockEventHandler();

      eventBus.on('test.event', 'plugin', handler);

      // CancelSubscription
      eventBus.off('test.event', 'plugin');

      await eventBus.emit('test.event', 'sender', {});
      await waitForEventProcessing(100);

      expect(handler).not.toHaveBeenCalled();
    });

    it('SubscriptionListYesGlobal共享of', () => {
      // ===== Description =====
      // =================

      eventBus.on('event-a', 'plugin-1', createMockEventHandler());
      eventBus.on('event-b', 'plugin-2', createMockEventHandler());

      // QuerySubscription
      const listenersA = eventBus.getListeners('event-a');
      const listenersB = eventBus.getListeners('event-b');

      expect(listenersA).toContain('plugin-1');
      expect(listenersB).toContain('plugin-2');
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Data Isolation', () => {
    it('userAof敏感Data不should泄露给userB (Hooks)', async () => {
      // ===== Description =====
      // =================

      const receivedData: Array<{ userId: string; payload: unknown }> = [];

      const handler = vi.fn(async (context) => {
        receivedData.push({
          userId: context.environment.userId || 'anonymous',
          payload: context.payload,
        });
        return null;
      });

      hookSystem.register('sensitive-plugin', 'onRenderHead', handler, 50);

      await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-1', requestId: 'req-user1-secret' },
        {
          url: '/test',
          pathname: '/test',
          sensitiveData: 'user1-secret-token',
          accountBalance: 1000000,
        } as { url: string; pathname: string; sensitiveData: string; accountBalance: number }
      );

      await hookSystem.execute('onRenderHead', { userId: 'user-2', requestId: 'req-user2' }, {
        url: '/test',
        pathname: '/test',
        sensitiveData: 'user2-data',
        accountBalance: 500,
      } as { url: string; pathname: string; sensitiveData: string; accountBalance: number });

      expect(receivedData.length).toBe(2);

      expect(receivedData[0].userId).toBe('user-1');
      expect((receivedData[0].payload as { sensitiveData: string }).sensitiveData).toBe(
        'user1-secret-token'
      );

      expect(receivedData[1].userId).toBe('user-2');
      expect((receivedData[1].payload as { sensitiveData: string }).sensitiveData).toBe(
        'user2-data'
      );
    });

    it('userAof敏感Data不should泄露给userB (Event Bus)', async () => {
      // ===== Description =====
      // =================

      const receivedPayloads: unknown[] = [];

      const handler = vi.fn(async (payload) => {
        receivedPayloads.push(payload);
      });

      eventBus.on('payment.processed', 'payment-handler', handler);

      await eventBus.emit('payment.processed', 'payment-gateway', {
        userId: 'user-1',
        transactionId: 'TXN-U1-12345',
        amount: 50000,
        creditCard: {
          lastFourDigits: '4321',
          type: 'VISA',
        },
      });

      await eventBus.emit('payment.processed', 'payment-gateway', {
        userId: 'user-2',
        transactionId: 'TXN-U2-67890',
        amount: 50,
        creditCard: {
          lastFourDigits: '8765',
          type: 'MasterCard',
        },
      });

      await waitForEventProcessing(100);

      expect(receivedPayloads.length).toBe(2);
      expect(
        (receivedPayloads[0] as { userId: string; creditCard: { lastFourDigits: string } }).userId
      ).toBe('user-1');
      expect(
        (receivedPayloads[1] as { userId: string; creditCard: { lastFourDigits: string } }).userId
      ).toBe('user-2');

      expect(
        (receivedPayloads[0] as { creditCard: { lastFourDigits: string } }).creditCard
          .lastFourDigits
      ).not.toBe('8765');
      expect(
        (receivedPayloads[1] as { creditCard: { lastFourDigits: string } }).creditCard
          .lastFourDigits
      ).not.toBe('4321');
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Concurrent Scenarios', () => {
    it('multipleuser并发执行hooksshould保持Data隔离', async () => {
      // ===== Description =====
      // =================

      const results: { [userId: string]: unknown[] } = {};

      const handler = vi.fn(async (context) => {
        const userId = context.environment.userId || 'anonymous';
        if (!results[userId]) {
          results[userId] = [];
        }
        results[userId].push({
          userId,
          timestamp: new Date(),
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { processed: true, userId };
      });

      hookSystem.register('plugin', 'onRenderHead', handler, 50);

      // multipleuser）
      const promises = [];
      for (let i = 1; i <= 3; i++) {
        for (let j = 0; j < 5; j++) {
          promises.push(
            hookSystem.execute(
              'onRenderHead',
              { userId: `user-${i}` },
              { url: '/test', pathname: '/test' }
            )
          );
        }
      }

      await Promise.all(promises);

      expect(results['user-1'].length).toBe(5);
      expect(results['user-2'].length).toBe(5);
      expect(results['user-3'].length).toBe(5);

      results['user-1'].forEach((item: any) => {
        expect(item.userId).toBe('user-1');
      });
    });

    it('multipleuser并发PublishEventshould正确处理', async () => {
      // ===== Description =====
      // =================

      const userEventCounts = new Map<string, number>();

      const handler = vi.fn(async (_payload: unknown) => {
        const payload = _payload as { userId: string; id: number };
        const userId = payload.userId;
        userEventCounts.set(userId, (userEventCounts.get(userId) || 0) + 1);
      });

      eventBus.on('test.event', 'plugin', handler);

      const promises = [];
      for (let user = 1; user <= 5; user++) {
        for (let i = 0; i < 10; i++) {
          promises.push(eventBus.emit('test.event', 'sender', { userId: `user-${user}`, id: i }));
        }
      }

      await Promise.all(promises);
      await waitForEventProcessing(200);

      for (let user = 1; user <= 5; user++) {
        expect(userEventCounts.get(`user-${user}`)).toBe(10);
      }
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Cross-System user Consistency', () => {
    it('HooksandEvent Bus之间ofuserIdshould一致', async () => {
      // ===== Description =====
      // =================

      const hookuserIds: string[] = [];
      const eventuserIds: string[] = [];

      const hookHandler = vi.fn(async (context) => {
        hookuserIds.push(context.environment.userId);
        return null;
      });

      const eventHandler = vi.fn(async (_payload: unknown) => {
        const payload = _payload as { userId: string };
        eventuserIds.push(payload.userId);
      });

      hookSystem.register('integrated-plugin', 'onRenderHead', hookHandler, 50);
      eventBus.on('test.event', 'integrated-plugin', eventHandler);

      //
      await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-xyz' },
        { url: '/test', pathname: '/test' }
      );
      await eventBus.emit('test.event', 'sender', { userId: 'user-xyz' });
      await waitForEventProcessing(100);

      expect(hookuserIds[0]).toBe('user-xyz');
      expect(eventuserIds[0]).toBe('user-xyz');
    });

    it('user切换when两Systemshould同步', async () => {
      // ===== Description =====
      // =================

      const executionLog: Array<{ system: string; userId: string }> = [];

      const hookHandler = vi.fn(async (context) => {
        executionLog.push({
          system: 'hooks',
          userId: context.environment.userId,
        });
        return null;
      });

      const eventHandler = vi.fn(async (_payload: unknown) => {
        const payload = _payload as { userId: string };
        executionLog.push({
          system: 'events',
          userId: payload.userId,
        });
      });

      hookSystem.register('plugin', 'onRenderHead', hookHandler, 50);
      eventBus.on('test.event', 'plugin', eventHandler);

      //
      await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-a' },
        { url: '/test', pathname: '/test' }
      );
      await eventBus.emit('test.event', 'sender', { userId: 'user-a' });
      await hookSystem.execute(
        'onRenderHead',
        { userId: 'user-b' },
        { url: '/test', pathname: '/test' }
      );
      await eventBus.emit('test.event', 'sender', { userId: 'user-b' });

      await waitForEventProcessing(100);

      expect(executionLog).toHaveLength(4);
      expect(executionLog[0]).toEqual({ system: 'hooks', userId: 'user-a' });
      expect(executionLog[1]).toEqual({ system: 'events', userId: 'user-a' });
      expect(executionLog[2]).toEqual({ system: 'hooks', userId: 'user-b' });
      expect(executionLog[3]).toEqual({ system: 'events', userId: 'user-b' });
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Edge Cases and Stress Tests', () => {
    it('大量user（100）should保持隔离性能', async () => {
      // ===== Description =====
      // =================

      const userCount = 100;
      const userExecutions = new Map<string, number>();

      const handler = vi.fn(async (context) => {
        const userId = context.environment.userId || 'anonymous';
        userExecutions.set(userId, (userExecutions.get(userId) || 0) + 1);
        return { userId };
      });

      hookSystem.register('plugin', 'onRenderHead', handler, 50);

      // userofhooks
      const promises = [];
      for (let i = 0; i < 50; i++) {
        const randomuser = `user-${Math.floor(Math.random() * userCount) + 1}`;
        promises.push(
          hookSystem.execute(
            'onRenderHead',
            { userId: randomuser },
            { url: '/test', pathname: '/test' }
          )
        );
      }

      await Promise.all(promises);

      let totalExecutions = 0;
      userExecutions.forEach((count) => {
        totalExecutions += count;
      });

      expect(totalExecutions).toBe(50);
    });

    it('userId特殊字符处理', async () => {
      // ===== Description =====
      // =================

      const specialuserIds = [
        'user-with-dash',
        'user_with_underscore',
        'user.with.dot',
        'user@with@at',
        'user-123-456',
      ];

      const _handlers = new Map<string, ReturnType<typeof vi.fn>>();
      const receiveduserIds: string[] = [];

      const handler = vi.fn(async (context) => {
        receiveduserIds.push(context.environment.userId);
        return { userId: context.environment.userId };
      });

      hookSystem.register('plugin', 'onRenderHead', handler, 50);

      // Eachuser
      for (const userId of specialuserIds) {
        await hookSystem.execute('onRenderHead', { userId }, { url: '/test', pathname: '/test' });
      }

      expect(receiveduserIds).toEqual(specialuserIds);
    });

    it('空userIdshouldbe处理', async () => {
      // ===== Description =====
      // =================

      const handler = vi.fn(async (context) => {
        return { userId: context.environment.userId || 'anonymous' };
      });

      hookSystem.register('plugin', 'onRenderHead', handler, 50);

      const results = await hookSystem.execute(
        'onRenderHead',
        {},
        { url: '/test', pathname: '/test' }
      );

      expect(results[0].success).toBe(true);
      expect((results[0].data as { userId: string }).userId).toBe('anonymous');
    });
  });
});
