/**
 * Slots System Test Helpers
 *
 * Provides test utilities including mock factories and assertion helpers.
 */

import { vi } from 'vitest';
import type { SlotRegistration } from '../types';

// ============================================================================
// Mock Data Factories
// ============================================================================

/**
 * Create a mock slot registration
 *
 * Note: Uses actual type-safe values by default to ensure type checking works.
 * For tests that need different values, use type assertions with overrides.
 */
export function createMockRegistration(
  overrides: Partial<SlotRegistration> = {}
): SlotRegistration {
  return {
    pluginId: 'welcome', // Use actual plugin ID from plugin-map
    slotName: 'header:logo', // Use actual slot name from types
    componentPath: './components/TestComponent.tsx',
    priority: 100,
    enabled: true,
    registeredAt: new Date('2025-01-01'),
    ...overrides,
  };
}

/**
 * Create multiple mock registrations
 */
export function createMockRegistrations(
  count: number,
  baseOverrides: Partial<SlotRegistration> = {}
): SlotRegistration[] {
  return Array.from({ length: count }, (_, i) =>
    createMockRegistration({
      componentPath: `./components/Component${i + 1}.tsx`,
      priority: 100 + i * 10,
      ...baseOverrides,
    })
  );
}

// ============================================================================
// React Component Mock
// ============================================================================

/**
 * Create a mock React component
 */
export function createMockComponent(name: string = 'MockComponent') {
  const MockComponent = () => null;

  // Set displayName for debugging
  MockComponent.displayName = name;

  return MockComponent;
}

// ============================================================================
// Plugin Map Mock
// ============================================================================

/**
 * Create a mock plugin map
 */
export function createMockPluginMap(plugins: Record<string, any> = {}) {
  return {
    'test-plugin': {
      plugin: () =>
        Promise.resolve({
          id: 'test-plugin',
          name: 'Test Plugin',
          version: '1.0.0',
          slots: {
            'header:logo': './components/Logo.tsx',
          },
        }),
      components: {
        Logo: () => Promise.resolve({ default: createMockComponent('Logo') }),
        TestComponent: () => Promise.resolve({ default: createMockComponent('TestComponent') }),
        Component1: () => Promise.resolve({ default: createMockComponent('Component1') }),
        Component2: () => Promise.resolve({ default: createMockComponent('Component2') }),
        Component3: () => Promise.resolve({ default: createMockComponent('Component3') }),
      },
    },
    ...plugins,
  };
}

// ============================================================================
// Database Mock
// ============================================================================

/**
 * Create mock database plugin records
 */
export function createMockDbPlugins(plugins: Array<{ pluginId: string; enabled: boolean }>) {
  return plugins.map((p) => ({
    id: Math.random().toString(),
    pluginId: p.pluginId,
    enabled: p.enabled,
    installedAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  }));
}

/**
 * Create a mock database client
 */
export function createMockDb(enabledPlugins: string[] = ['test-plugin']) {
  const mockPlugins = createMockDbPlugins(
    enabledPlugins.map((id) => ({ pluginId: id, enabled: true }))
  );

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(mockPlugins)),
      })),
    })),
  };
}

// ============================================================================
// Logger Mock
// ============================================================================

/**
 * Create a mock logger
 */
export function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert that a registration exists
 */
export function assertRegistrationExists(
  slots: Map<string, SlotRegistration[]>,
  slotName: string,
  pluginId: string,
  componentPath: string
): boolean {
  const registrations = slots.get(slotName) || [];
  return registrations.some((r) => r.pluginId === pluginId && r.componentPath === componentPath);
}

/**
 * Get the count of registrations for a slot
 */
export function getRegistrationCount(
  slots: Map<string, SlotRegistration[]>,
  slotName: string
): number {
  return (slots.get(slotName) || []).length;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Wait for a specified time (useful for async tests)
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a mock runtime contract slot declaration.
 */
export function createMockContractSlots(slots: Record<string, string | string[]> = {}) {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    slots,
    slotPriority: 100,
  };
}
