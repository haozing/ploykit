/**
 *
 * - renderSlot() Feature
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SlotManager } from '../slot-manager';
import { createMockRegistration, createMockComponent } from './helpers';

// Mock React
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    createElement: vi.fn((component, props, ...children) => ({
      type: component,
      props: { ...props, children },
    })),
  };
});

// Mock dependencies
vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Create mock components for testing
const MockComponent1 = createMockComponent('Component1');
const MockComponent2 = createMockComponent('Component2');
const MockComponent3 = createMockComponent('Component3');

vi.mock('@/lib/plugin-map', () => ({
  DEFAULT_RUNTIME_PRODUCT_ID: 'ploykit',
  RUNTIME_PRODUCTS: {
    ploykit: { id: 'ploykit', name: 'PloyKit', suites: ['default'], bundles: [] },
  },
  PLUGIN_SUITES: {},
  APP_BUNDLES: {},
  PLUGIN_MAP: {
    welcome: {
      productId: 'ploykit',
      suiteId: 'default',
      bundleIds: [],
      plugin: vi.fn(),
      components: {
        'components/Component1': () => Promise.resolve({ default: MockComponent1 }),
        'components/Component2': () => Promise.resolve({ default: MockComponent2 }),
        'components/Component3': () => Promise.resolve({ default: MockComponent3 }),
        'components/FailingComponent': () => Promise.reject(new Error('Component load failed')),
      },
      slotModules: {
        'slots/SlotComponent': () => Promise.resolve({ default: MockComponent1 }),
      },
    },
  },
}));

// ============================================================================
// ============================================================================

describe('SlotManager - Rendering and Caching', () => {
  let slotManager: SlotManager;

  beforeEach(() => {
    slotManager = new SlotManager();
    (slotManager as unknown as { initialized: boolean }).initialized = true;
    vi.clearAllMocks();
  });

  const registerTrusted = (registration: ReturnType<typeof createMockRegistration>) => {
    slotManager.register(registration, { pluginTrustLevel: 'trusted' });
  };

  // ==========================================================================
  // renderSlot() BaseFeature
  // ==========================================================================

  describe('renderSlot()', () => {
    it('shouldBack空ArrayWhen插槽没有Registerwhen', async () => {
      const result = await slotManager.renderSlot('header:logo');

      expect(result).toEqual([]);
    });

    it('should渲染RegisteredofComponent', async () => {
      registerTrusted(
        createMockRegistration({
          slotName: 'header:logo',
          componentPath: './components/Component1.tsx',
        })
      );

      const result = await slotManager.renderSlot('header:logo');

      expect(result).toHaveLength(1);
      expect(result[0]).toBeDefined();
    });

    it('should只渲染EnableofRegister', async () => {
      registerTrusted(
        createMockRegistration({
          enabled: true,
          componentPath: './components/Component1.tsx',
        })
      );

      registerTrusted(
        createMockRegistration({
          enabled: false,
          componentPath: './components/Component2.tsx',
        })
      );

      const result = await slotManager.renderSlot('header:logo');

      expect(result).toHaveLength(1);
    });
  });

  // ==========================================================================
  //
  // ==========================================================================

  describe('渲染模式', () => {
    beforeEach(() => {
      registerTrusted(
        createMockRegistration({
          slotName: 'header:logo',
          componentPath: './components/Component1.tsx',
          priority: 10,
        })
      );

      registerTrusted(
        createMockRegistration({
          slotName: 'header:logo',
          componentPath: './components/Component2.tsx',
          priority: 20,
        })
      );

      registerTrusted(
        createMockRegistration({
          slotName: 'header:logo',
          componentPath: './components/Component3.tsx',
          priority: 30,
        })
      );
    });

    it('append 模式should渲染AllComponent', async () => {
      const result = await slotManager.renderSlot('header:logo', 'append');

      expect(result).toHaveLength(3);
    });

    it('replace 模式should只渲染第一（优先级最高of）Component', async () => {
      const result = await slotManager.renderSlot('header:logo', 'replace');

      expect(result).toHaveLength(1);
    });

    it('default模式shouldYes append', async () => {
      const resultDefault = await slotManager.renderSlot('header:logo');
      const resultAppend = await slotManager.renderSlot('header:logo', 'append');

      expect(resultDefault).toHaveLength(3);
      expect(resultAppend).toHaveLength(3);
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('🐛 Bug Fix: 缓存键Must include componentPath', () => {
    it('不同ComponentshouldUsedifferent缓存键', async () => {
      registerTrusted(
        createMockRegistration({
          pluginId: 'welcome',
          slotName: 'header:logo',
          componentPath: './components/Component1.tsx',
        })
      );

      registerTrusted(
        createMockRegistration({
          pluginId: 'welcome',
          slotName: 'header:logo',
          componentPath: './components/Component2.tsx',
        })
      );

      await slotManager.renderSlot('header:logo');
      await slotManager.renderSlot('header:logo');

      const stats = slotManager.getStats();

      expect(stats.cachedComponents).toBe(2);
    });

    it('同一Component第二timesLoadingshouldUse缓存', async () => {
      registerTrusted(
        createMockRegistration({
          pluginId: 'welcome',
          slotName: 'header:logo',
          componentPath: './components/Component1.tsx',
        })
      );

      await slotManager.renderSlot('header:logo');
      const stats1 = slotManager.getStats();
      expect(stats1.cachedComponents).toBe(1);

      await slotManager.renderSlot('header:logo');
      const stats2 = slotManager.getStats();
      expect(stats2.cachedComponents).toBe(1); //
    });

    it('不同插槽of相同ComponentPathshould分别缓存', async () => {
      const componentPath = './components/Component1.tsx';

      registerTrusted(
        createMockRegistration({
          pluginId: 'welcome',
          slotName: 'header:logo',
          componentPath,
        })
      );

      registerTrusted(
        createMockRegistration({
          pluginId: 'welcome',
          slotName: 'footer:links',
          componentPath,
        })
      );

      await slotManager.renderSlot('header:logo');
      await slotManager.renderSlot('footer:links');

      const stats = slotManager.getStats();

      // Format：`${pluginId}:${slotName}:${componentPath}`
      expect(stats.cachedComponents).toBe(2);
    });
  });

  // ==========================================================================
  // ComponentLoading
  // ==========================================================================

  describe('ComponentLoading', () => {
    it('shouldfrom PLUGIN_MAP 正确LoadingComponent', async () => {
      registerTrusted(
        createMockRegistration({
          pluginId: 'welcome',
          slotName: 'header:logo',
          componentPath: './components/Component1.tsx',
        })
      );

      const result = await slotManager.renderSlot('header:logo');

      expect(result).toHaveLength(1);
      expect(result[0]).toBeDefined();
    });

    it('should正确ExtractComponentName', async () => {
      // TestdifferentPathFormat
      const testCases = [
        { path: './components/Component1.tsx' },
        { path: 'components/Component1.tsx' },
      ];

      for (const testCase of testCases) {
        const manager = new SlotManager();
        (manager as unknown as { initialized: boolean }).initialized = true;
        manager.register(
          createMockRegistration({
            slotName: 'header:logo',
            componentPath: testCase.path,
          }),
          { pluginTrustLevel: 'trusted' }
        );

        await expect(manager.renderSlot('header:logo')).resolves.not.toThrow();
      }
    });

    it('loads slot components from dedicated slot modules', async () => {
      registerTrusted(
        createMockRegistration({
          pluginId: 'welcome',
          slotName: 'header:logo',
          componentPath: './slots/SlotComponent.tsx',
        })
      );

      const result = await slotManager.renderSlot('header:logo');

      expect(result).toHaveLength(1);
    });

    it('renders route-scoped slots when their path pattern matches', async () => {
      registerTrusted(
        createMockRegistration({
          pluginId: 'welcome',
          slotName: 'route:/json:main.before',
          componentPath: './slots/SlotComponent.tsx',
        })
      );

      await expect(slotManager.renderRouteSlot('/json', 'main.before')).resolves.toHaveLength(1);
      await expect(slotManager.renderRouteSlot('/other', 'main.before')).resolves.toEqual([]);
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Error处理', () => {
    it('ComponentLoadingFailedwhenshouldBack null 并Continue渲染OtherComponent', async () => {
      registerTrusted(
        createMockRegistration({
          componentPath: './components/Component1.tsx',
        })
      );

      registerTrusted(
        createMockRegistration({
          componentPath: './components/FailingComponent.tsx',
        })
      );

      registerTrusted(
        createMockRegistration({
          componentPath: './components/Component2.tsx',
        })
      );

      const result = await slotManager.renderSlot('header:logo');

      expect(result).toHaveLength(2);
    });

    it('Plugindoes not existwhenshouldRecordError并Back空Result', async () => {
      registerTrusted(
        createMockRegistration({
          pluginId: 'non-existent-plugin',
        })
      );

      const result = await slotManager.renderSlot('header:logo');

      expect(result).toEqual([]);
    });

    it('Componentdoes not existwhenshouldRecordError并Back空Result', async () => {
      registerTrusted(
        createMockRegistration({
          pluginId: 'welcome',
          componentPath: './components/NonExistentComponent.tsx',
        })
      );

      const result = await slotManager.renderSlot('header:logo');

      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('unregister() 缓存清除', () => {
    it('should清除PluginofComponent缓存', async () => {
      registerTrusted(
        createMockRegistration({
          pluginId: 'welcome',
          slotName: 'header:logo',
          componentPath: './components/Component1.tsx',
        })
      );

      await slotManager.renderSlot('header:logo');

      const statsBefore = slotManager.getStats();
      expect(statsBefore.cachedComponents).toBe(1);

      // CancelRegister
      slotManager.unregister('welcome');

      const statsAfter = slotManager.getStats();
      expect(statsAfter.cachedComponents).toBe(0);
    });
  });
});
