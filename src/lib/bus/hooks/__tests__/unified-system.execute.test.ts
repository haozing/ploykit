import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnifiedHookSystem } from '../unified-system';

vi.mock('../context', () => ({
  HookContextBuilder: {
    build: vi.fn(async (pluginId, hookName, environment, payload) => ({
      plugin: {
        id: pluginId,
        contract: { id: pluginId, name: pluginId, version: '1.0.0' },
        logger: {},
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

describe('UnifiedHookSystem - Execute', () => {
  let hookSystem: UnifiedHookSystem;

  beforeEach(() => {
    hookSystem = new UnifiedHookSystem();
  });

  it('executes hooks and returns isolated results', async () => {
    const success = vi.fn(async () => [{ tag: 'meta', attrs: { name: 'description' } }]);
    const failure = vi.fn(async () => {
      throw new Error('boom');
    });

    hookSystem.register('plugin-a', 'onRenderHead', success, 10);
    hookSystem.register('plugin-b', 'onRenderHead', failure, 20);

    const results = await hookSystem.execute(
      'onRenderHead',
      { userId: 'user-1' },
      { url: '/test', pathname: '/test' }
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ success: true, pluginId: 'plugin-a' });
    expect(results[1]).toMatchObject({ success: false, pluginId: 'plugin-b', error: 'boom' });
  });

  it('filters execution to enabled plugin IDs', async () => {
    const handlerA = vi.fn(async () => 'a');
    const handlerB = vi.fn(async () => 'b');

    hookSystem.register('plugin-a', 'onRenderHead', handlerA, 10);
    hookSystem.register('plugin-b', 'onRenderHead', handlerB, 20);

    const results = await hookSystem.execute(
      'onRenderHead',
      {},
      { url: '/test', pathname: '/test' },
      { pluginIds: ['plugin-b'] }
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ success: true, pluginId: 'plugin-b', data: 'b' });
    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  it('clears timeout timers after a fast hook completes', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    try {
      hookSystem.register(
        'plugin-a',
        'onRenderHead',
        vi.fn(async () => 'ok'),
        10
      );

      const results = await hookSystem.execute(
        'onRenderHead',
        {},
        { url: '/test', pathname: '/test' },
        { timeoutMs: 1000 }
      );

      expect(results[0]).toMatchObject({ success: true, data: 'ok' });
      expect(clearTimeoutSpy).toHaveBeenCalled();
    } finally {
      clearTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('reports timeout failures without throwing the whole execution', async () => {
    vi.useFakeTimers();

    try {
      hookSystem.register(
        'slow-plugin',
        'onRenderHead',
        vi.fn(() => new Promise((resolve) => setTimeout(() => resolve('late'), 1000))),
        10
      );

      const execution = hookSystem.execute(
        'onRenderHead',
        {},
        { url: '/test', pathname: '/test' },
        { timeoutMs: 10 }
      );

      await vi.advanceTimersByTimeAsync(10);
      const results = await execution;

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('Hook execution timeout after 10ms');
    } finally {
      vi.useRealTimers();
    }
  });

  it('executeSequential respects priority order', async () => {
    const calls: string[] = [];

    hookSystem.register(
      'plugin-b',
      'onBeforeHandle',
      vi.fn(async () => {
        calls.push('b');
        return {};
      }),
      20
    );
    hookSystem.register(
      'plugin-a',
      'onBeforeHandle',
      vi.fn(async () => {
        calls.push('a');
        return {};
      }),
      10
    );

    const results = await hookSystem.executeSequential(
      'onBeforeHandle',
      {},
      {
        request: new Request('https://example.com/test'),
        route: { path: '/test', method: 'GET' },
      }
    );

    expect(results.map((result) => result.pluginId)).toEqual(['plugin-a', 'plugin-b']);
    expect(calls).toEqual(['a', 'b']);
  });
});
