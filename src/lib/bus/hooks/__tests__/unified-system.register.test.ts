import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UnifiedHookSystem } from '../unified-system';
import type { AllHookName } from '../types';
import { createMockHandler, cleanupHookSystem, registerMultiple } from './helpers';

describe('UnifiedHookSystem - Registration', () => {
  let hookSystem: UnifiedHookSystem;

  beforeEach(() => {
    hookSystem = new UnifiedHookSystem();
  });

  afterEach(() => {
    cleanupHookSystem(hookSystem);
  });

  describe('Basic Registration', () => {
    it('registers hooks with concrete handlers', () => {
      const mockHandler = createMockHandler();

      hookSystem.register('test-plugin', 'onRenderHead', mockHandler, 50);

      expect(hookSystem.hasHook('test-plugin', 'onRenderHead')).toBe(true);
      expect(hookSystem.getPlugins('onRenderHead')).toContain('test-plugin');
      expect(hookSystem.getStats()).toMatchObject({
        preLoaded: 1,
        lazyLoad: 0,
      });
    });

    it('rejects hook registration without a concrete handler', () => {
      expect(() => {
        hookSystem.register('test-plugin', 'onInstall', null as unknown as any, 100);
      }).toThrow('handler must be a function');

      expect(hookSystem.hasHook('test-plugin', 'onInstall')).toBe(false);
      expect(hookSystem.getStats()).toMatchObject({
        preLoaded: 0,
        lazyLoad: 0,
      });
    });

    it('registerFromContract validates declarations but does not create empty handlers', () => {
      const hookNames = ['onInstall', 'onEnable', 'onDisable'] as const;

      hookSystem.registerFromContract('test-plugin', hookNames as unknown as AllHookName[], 100);

      expect(hookSystem.getPluginHooks('test-plugin')).toEqual([]);
      expect(hookSystem.getStats()).toMatchObject({
        preLoaded: 0,
        lazyLoad: 0,
      });
    });

    it('allows the same plugin to register multiple different hooks', () => {
      const handler = createMockHandler();

      hookSystem.register('test-plugin', 'onRenderHead', handler, 50);
      hookSystem.register('test-plugin', 'onBeforeHandle', handler, 50);
      hookSystem.register('test-plugin', 'onAfterHandle', handler, 50);

      expect(hookSystem.getPluginHooks('test-plugin')).toEqual([
        'onAfterHandle',
        'onBeforeHandle',
        'onRenderHead',
      ]);
    });
  });

  describe('Priority Ordering', () => {
    it('sorts hooks by priority, with lower numbers first', () => {
      hookSystem.register('plugin-c', 'onRenderHead', createMockHandler(), 100);
      hookSystem.register('plugin-a', 'onRenderHead', createMockHandler(), 10);
      hookSystem.register('plugin-b', 'onRenderHead', createMockHandler(), 50);

      expect(hookSystem.getPlugins('onRenderHead')).toEqual(['plugin-a', 'plugin-b', 'plugin-c']);
    });

    it('preserves insertion order for equal priority hooks', () => {
      const handler = createMockHandler();

      hookSystem.register('plugin-a', 'onRenderHead', handler, 50);
      hookSystem.register('plugin-b', 'onRenderHead', handler, 50);
      hookSystem.register('plugin-c', 'onRenderHead', handler, 50);

      expect(hookSystem.getPlugins('onRenderHead')).toEqual(['plugin-a', 'plugin-b', 'plugin-c']);
    });
  });

  describe('Input Validation', () => {
    it('rejects empty plugin IDs', () => {
      expect(() => {
        hookSystem.register('', 'onRenderHead', createMockHandler(), 50);
      }).toThrow('pluginId cannot be empty');
    });

    it('rejects invalid plugin ID formats', () => {
      const handler = createMockHandler();

      expect(() => {
        hookSystem.register('InvalidPlugin', 'onRenderHead', handler, 50);
      }).toThrow('pluginId must contain only lowercase letters');

      expect(() => {
        hookSystem.register('invalid plugin', 'onRenderHead', handler, 50);
      }).toThrow('pluginId must contain only lowercase letters');
    });

    it('rejects invalid hook names', () => {
      const handler = createMockHandler();

      expect(() => {
        hookSystem.register('test-plugin', 'onInvalidHook' as unknown as AllHookName, handler, 50);
      }).toThrow('Invalid hook name');

      expect(() => {
        hookSystem.register('test-plugin', 'onRenderhead' as unknown as AllHookName, handler, 50);
      }).toThrow('Invalid hook name');
    });

    it('rejects negative priorities', () => {
      expect(() => {
        hookSystem.register('test-plugin', 'onRenderHead', createMockHandler(), -10);
      }).toThrow('priority must be non-negative');
    });
  });

  describe('Query Operations', () => {
    it('queries all plugins registered for a hook', () => {
      const handler = createMockHandler();

      hookSystem.register('plugin-a', 'onRenderHead', handler, 10);
      hookSystem.register('plugin-b', 'onRenderHead', handler, 20);
      hookSystem.register('plugin-c', 'onRenderHead', handler, 30);

      expect(hookSystem.getPlugins('onRenderHead')).toEqual(['plugin-a', 'plugin-b', 'plugin-c']);
    });

    it('queries all hooks registered by a plugin', () => {
      const handler = createMockHandler();

      hookSystem.register('test-plugin', 'onRenderHead', handler, 50);
      hookSystem.register('test-plugin', 'onBeforeHandle', handler, 50);
      hookSystem.register('test-plugin', 'onAfterHandle', handler, 50);

      expect(hookSystem.getPluginHooks('test-plugin')).toEqual([
        'onAfterHandle',
        'onBeforeHandle',
        'onRenderHead',
      ]);
    });

    it('returns empty arrays for missing hooks and plugins', () => {
      expect(hookSystem.getPlugins('onRenderHead')).toEqual([]);
      expect(hookSystem.getPluginHooks('nonexistent-plugin')).toEqual([]);
    });
  });

  describe('Statistics', () => {
    it('counts only executable hook registrations', () => {
      const handler = createMockHandler();

      hookSystem.register('plugin-a', 'onRenderHead', handler, 50);
      hookSystem.register('plugin-a', 'onBeforeHandle', handler, 50);
      hookSystem.register('plugin-b', 'onRenderHead', handler, 50);
      hookSystem.registerFromContract('plugin-c', ['onInstall', 'onEnable'], 100);

      expect(hookSystem.getStats()).toMatchObject({
        totalPlugins: 2,
        preLoaded: 3,
        lazyLoad: 0,
      });
    });
  });

  describe('Helper Functions', () => {
    it('registerMultiple registers each hook', () => {
      registerMultiple(hookSystem, [
        {
          pluginId: 'plugin-a',
          hookName: 'onRenderHead',
          handler: createMockHandler(),
          priority: 10,
        },
        {
          pluginId: 'plugin-b',
          hookName: 'onBeforeHandle',
          handler: createMockHandler(),
          priority: 20,
        },
      ]);

      expect(hookSystem.hasHook('plugin-a', 'onRenderHead')).toBe(true);
      expect(hookSystem.hasHook('plugin-b', 'onBeforeHandle')).toBe(true);
    });
  });
});
