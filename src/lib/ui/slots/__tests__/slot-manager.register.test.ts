/**
 * Slot Manager Registration Tests
 *
 * Tests for:
 * - register() method
 * - registerFromContract() method
 * - unregister() method
 * - Slot name validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SlotManager } from '../slot-manager';
import { createMockRegistration } from './helpers';
import { isValidSlotName, VALID_SLOT_NAMES } from '../types';

const mockGetOrLoad = vi.hoisted(() => vi.fn());

// Mock dependencies
vi.mock('@/lib/_core/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

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
      components: {},
    },
  },
}));

vi.mock('@/lib/plugin-runtime/registry', () => ({
  pluginRuntimeRegistry: {
    getOrLoad: mockGetOrLoad,
  },
}));

// ============================================================================
// register() Tests
// ============================================================================

describe('SlotManager - register()', () => {
  let slotManager: SlotManager;

  beforeEach(() => {
    slotManager = new SlotManager();
    vi.clearAllMocks();
    mockGetOrLoad.mockResolvedValue({
      id: 'welcome',
      trustLevel: 'trusted',
      slots: {},
    });
  });

  const registerTrusted = (registration: ReturnType<typeof createMockRegistration>) => {
    slotManager.register(registration, { pluginTrustLevel: 'trusted' });
  };

  it('should register a slot successfully', () => {
    const registration = createMockRegistration();

    registerTrusted(registration);

    const stats = slotManager.getStats();
    expect(stats.totalSlots).toBe(1);
    expect(stats.totalRegistrations).toBe(1);
  });

  it('should register multiple slots for the same slot name', () => {
    registerTrusted(
      createMockRegistration({
        componentPath: './components/Component1.tsx',
        priority: 10,
      })
    );

    registerTrusted(
      createMockRegistration({
        componentPath: './components/Component2.tsx',
        priority: 20,
      })
    );

    const stats = slotManager.getStats();
    expect(stats.totalSlots).toBe(1); // Same slot name
    expect(stats.totalRegistrations).toBe(2); // Two registrations
  });

  it('should not register duplicate slots', () => {
    const registration = createMockRegistration();

    registerTrusted(registration);
    registerTrusted(registration); // Duplicate

    const stats = slotManager.getStats();
    expect(stats.totalRegistrations).toBe(1); // Only one registration
  });

  it('should enforce slot policy during manual registration', () => {
    slotManager.register(createMockRegistration({ slotName: 'head:scripts' }), {
      pluginTrustLevel: 'trusted',
    });

    expect(slotManager.getStats().totalRegistrations).toBe(0);

    slotManager.register(createMockRegistration({ slotName: 'head:scripts' }), {
      pluginTrustLevel: 'system',
    });

    expect(slotManager.getStats().totalRegistrations).toBe(1);
  });

  it('should sort registrations by priority', () => {
    registerTrusted(
      createMockRegistration({
        componentPath: './components/Low.tsx',
        priority: 100,
      })
    );

    registerTrusted(
      createMockRegistration({
        componentPath: './components/High.tsx',
        priority: 10,
      })
    );

    registerTrusted(
      createMockRegistration({
        componentPath: './components/Medium.tsx',
        priority: 50,
      })
    );

    const state = slotManager.getDetailedState();
    const registrations = state['header:logo'];

    expect(registrations[0].componentPath).toBe('./components/High.tsx');
    expect(registrations[1].componentPath).toBe('./components/Medium.tsx');
    expect(registrations[2].componentPath).toBe('./components/Low.tsx');
  });
});

describe('SlotManager - registerFromContract()', () => {
  let slotManager: SlotManager;

  beforeEach(() => {
    slotManager = new SlotManager();
    vi.clearAllMocks();
  });

  it('registers contract slot declarations for trusted plugins', async () => {
    mockGetOrLoad.mockResolvedValue({
      id: 'welcome',
      trustLevel: 'trusted',
      slots: {
        'header:extra': './slots/HeaderExtra.tsx',
        'route:/json:main.before': './slots/JsonBanner.tsx',
        'site.home:main.after': [
          './slots/HomeAfter.tsx',
          { component: './slots/HomeSurvey.tsx', priority: 10 },
        ],
      },
    });

    await slotManager.registerFromContract('welcome');

    const state = slotManager.getDetailedState();
    expect(state['header:extra'][0].componentPath).toBe('./slots/HeaderExtra.tsx');
    expect(state['route:/json:main.before'][0].componentPath).toBe('./slots/JsonBanner.tsx');
    expect(state['site.home:main.after']).toHaveLength(2);
    expect(state['site.home:main.after'][0].priority).toBe(10);
    expect(slotManager.countPluginRegistrations('welcome')).toBe(4);
  });

  it('blocks elevated slots for non-system plugins', async () => {
    mockGetOrLoad.mockResolvedValue({
      id: 'welcome',
      trustLevel: 'trusted',
      slots: {
        'head:scripts': './slots/HeadScripts.tsx',
      },
    });

    await slotManager.registerFromContract('welcome');

    expect(slotManager.getStats().totalRegistrations).toBe(0);
  });

  it('allows elevated slots for system plugins', async () => {
    mockGetOrLoad.mockResolvedValue({
      id: 'welcome',
      trustLevel: 'system',
      slots: {
        'head:scripts': './slots/HeadScripts.tsx',
      },
    });

    await slotManager.registerFromContract('welcome');

    expect(slotManager.getSlotCount('head:scripts')).toBe(1);
  });
});

// ============================================================================
// unregister() Tests
// ============================================================================

describe('SlotManager - unregister()', () => {
  let slotManager: SlotManager;

  beforeEach(() => {
    slotManager = new SlotManager();
    vi.clearAllMocks();
  });

  const registerTrusted = (registration: ReturnType<typeof createMockRegistration>) => {
    slotManager.register(registration, { pluginTrustLevel: 'trusted' });
  };

  it('should unregister all slots for a plugin', () => {
    registerTrusted(
      createMockRegistration({
        pluginId: 'welcome',
        slotName: 'header:logo',
      })
    );

    registerTrusted(
      createMockRegistration({
        pluginId: 'welcome',
        slotName: 'footer:links',
      })
    );

    expect(slotManager.getStats().totalSlots).toBe(2);

    slotManager.unregister('welcome');

    expect(slotManager.getStats().totalSlots).toBe(0);
  });

  it('should only unregister slots for the specified plugin', () => {
    registerTrusted(
      createMockRegistration({
        pluginId: 'welcome',
        slotName: 'header:logo',
      })
    );

    registerTrusted(
      createMockRegistration({
        pluginId: 'other-plugin' as any,
        slotName: 'header:nav',
      })
    );

    slotManager.unregister('welcome');

    const stats = slotManager.getStats();
    expect(stats.totalSlots).toBe(1);
    expect(stats.totalRegistrations).toBe(1);
  });
});

// ============================================================================
// Slot Name Validation Tests
// ============================================================================

describe('SlotName Validation', () => {
  it('should validate known slot names', () => {
    expect(isValidSlotName('header:logo')).toBe(true);
    expect(isValidSlotName('header:nav')).toBe(true);
    expect(isValidSlotName('footer:links')).toBe(true);
    expect(isValidSlotName('site.home:hero.before')).toBe(true);
  });

  it('should reject invalid slot names', () => {
    expect(isValidSlotName('header:logoo')).toBe(false); // Typo
    expect(isValidSlotName('invalid:slot')).toBe(false);
    expect(isValidSlotName('custom:whatever')).toBe(false);
    expect(isValidSlotName('')).toBe(false);
  });

  it('should have all SlotName values in VALID_SLOT_NAMES', () => {
    // Ensure the set has a reasonable number of entries
    expect(VALID_SLOT_NAMES.size).toBeGreaterThan(30);

    // Spot check some important slots
    expect(VALID_SLOT_NAMES.has('header:logo')).toBe(true);
    expect(VALID_SLOT_NAMES.has('footer:content')).toBe(true);
    expect(VALID_SLOT_NAMES.has('body:end')).toBe(true);
  });
});

// ============================================================================
// getStats() and getDetailedState() Tests
// ============================================================================

describe('SlotManager - Statistics', () => {
  let slotManager: SlotManager;

  beforeEach(() => {
    slotManager = new SlotManager();
  });

  const registerTrusted = (registration: ReturnType<typeof createMockRegistration>) => {
    slotManager.register(registration, { pluginTrustLevel: 'trusted' });
  };

  it('should return correct stats for empty manager', () => {
    const stats = slotManager.getStats();

    expect(stats.totalSlots).toBe(0);
    expect(stats.totalRegistrations).toBe(0);
    expect(stats.cachedComponents).toBe(0);
    expect(stats.slots).toEqual([]);
  });

  it('should return correct stats after registrations', () => {
    registerTrusted(createMockRegistration({ slotName: 'header:logo' }));
    registerTrusted(createMockRegistration({ slotName: 'header:nav' }));
    registerTrusted(
      createMockRegistration({
        slotName: 'header:logo',
        componentPath: './components/Another.tsx',
      })
    );

    const stats = slotManager.getStats();

    expect(stats.totalSlots).toBe(2);
    expect(stats.totalRegistrations).toBe(3);
  });

  it('should return detailed state with all registration info', () => {
    const registration = createMockRegistration();
    registerTrusted(registration);

    const state = slotManager.getDetailedState();

    expect(state['header:logo']).toBeDefined();
    expect(state['header:logo'][0].pluginId).toBe('welcome');
    expect(state['header:logo'][0].componentPath).toBe('./components/TestComponent.tsx');
    expect(state['header:logo'][0].priority).toBe(100);
    expect(state['header:logo'][0].enabled).toBe(true);
  });
});

// ============================================================================
// getSlotCount() Tests
// ============================================================================

describe('SlotManager - getSlotCount()', () => {
  let slotManager: SlotManager;

  beforeEach(() => {
    slotManager = new SlotManager();
  });

  const registerTrusted = (registration: ReturnType<typeof createMockRegistration>) => {
    slotManager.register(registration, { pluginTrustLevel: 'trusted' });
  };

  it('should return 0 for unregistered slots', () => {
    expect(slotManager.getSlotCount('header:logo')).toBe(0);
  });

  it('should return correct count for registered slots', () => {
    registerTrusted(createMockRegistration({ slotName: 'header:logo' }));
    registerTrusted(
      createMockRegistration({
        slotName: 'header:logo',
        componentPath: './components/Another.tsx',
      })
    );

    expect(slotManager.getSlotCount('header:logo')).toBe(2);
  });

  it('should only count enabled registrations', () => {
    registerTrusted(createMockRegistration({ enabled: true }));
    registerTrusted(
      createMockRegistration({
        enabled: false,
        componentPath: './components/Disabled.tsx',
      })
    );

    expect(slotManager.getSlotCount('header:logo')).toBe(1);
  });
});
