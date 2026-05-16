/**
 * Plugin System Test Helpers
 */

import { vi } from 'vitest';
import type { PluginInstallation } from '../plugin-types';

//
// Test Constants
//

export const TEST_PLUGIN_ID = 'test-plugin';
export const TEST_USER_ID = 'user-123';
export const TEST_PLUGIN_VERSION = '1.0.0';

//
// Mock Data Factories
//

/**
 * Create a mock plugin installation for testing
 */
export function createMockInstallation(
  overrides?: Partial<PluginInstallation>
): PluginInstallation {
  return {
    id: '1',
    productId: 'ploykit',
    suiteId: 'test-suite',
    bundleId: 'test-bundle',
    pluginId: TEST_PLUGIN_ID,
    version: TEST_PLUGIN_VERSION,
    enabled: false,
    installStatus: 'installed',
    metadata: {},
    installedAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    installedBy: TEST_USER_ID,
    ...overrides,
  };
}

/**
 * Create a mock database select result
 */
export function createMockDbSelectResult<T>(data: T[]) {
  return data;
}

/**
 * Create a mock database insert result
 */
export function createMockDbInsertResult<T>(data: T) {
  return [data];
}

//
// Mock Database Builder
//

/**
 * const mockSelect = createMockQueryBuilder([mockInstallation]);
 * vi.mocked(db.select).mockReturnValue(mockSelect as any);
 * ```
 */
export function createMockQueryBuilder<T>(resultData: T[]) {
  const builder = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    for: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(resultData),
  };

  // Make it thenable for direct await
  (builder as any).then = (resolve: (value: T[]) => void) => {
    return Promise.resolve(resultData).then(resolve);
  };

  return builder;
}

/**
 * Create mock update builder
 */
export function createMockUpdateBuilder<T>(resultData: T[]) {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(resultData),
  };
}

/**
 * Create mock delete builder
 */
export function createMockDeleteBuilder() {
  return {
    where: vi.fn().mockReturnThis(),
  };
}

/**
 * Create mock insert builder
 */
export function createMockInsertBuilder<T>(resultData: T[]) {
  return {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(resultData),
  };
}

//
// Mock Transaction
//

/**
 *
 * const mockTx = createMockTransaction();
 * vi.mocked(db.transaction).mockImplementation(async (fn) => fn(mockTx as any));
 * ```
 */
export function createMockTransaction() {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
  };
}

//
// Cleanup Utilities
//

/**
 * Clear all vi mocks
 */
export function clearAllMocks() {
  vi.clearAllMocks();
}

/**
 * Reset all vi mocks
 */
export function resetAllMocks() {
  vi.resetAllMocks();
}

//
// Assertion Helpers
//

/**
 * Assert that result is successful
 */
export function expectSuccess(result: { success: boolean; error?: string }) {
  if (!result.success) {
    throw new Error(`Expected success but got error: ${result.error}`);
  }
}

/**
 * Assert that result is a failure
 */
export function expectFailure(result: { success: boolean; error?: string }) {
  if (result.success) {
    throw new Error('Expected failure but got success');
  }
}

/**
 * WaitAsyncActionsComplete
 */
export async function waitFor(ms: number = 100): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
