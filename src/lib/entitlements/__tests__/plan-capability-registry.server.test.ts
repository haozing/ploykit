import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanCapabilityDefinition } from '../plan-capability-types';

const mocks = vi.hoisted(() => ({
  listRuntimeProducts: vi.fn(),
}));

vi.mock('@/lib/plugin-runtime/loader', () => ({
  DEFAULT_PRODUCT_ID: 'ploykit',
  listRuntimeProducts: mocks.listRuntimeProducts,
}));

import {
  listPlanCapabilityDefinitions,
  normalizePlanFeaturesForStorage,
} from '../plan-capability-registry.server';

function capability(overrides: Partial<PlanCapabilityDefinition> = {}): PlanCapabilityDefinition {
  return {
    key: 'sample.outputQuality',
    valueType: 'enum',
    ownerType: 'product',
    ownerId: 'sample',
    required: true,
    defaultValue: 'hd',
    options: [{ value: 'sd' }, { value: 'hd' }],
    sortOrder: 100,
    ...overrides,
  };
}

describe('plan capability registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listRuntimeProducts.mockReturnValue([
      {
        id: 'ploykit',
        name: 'PloyKit',
        planCapabilities: [],
      },
      {
        id: 'sample',
        name: 'Sample',
        planCapabilities: [capability()],
      },
    ]);
  });

  it('lists product catalog capability definitions', () => {
    expect(listPlanCapabilityDefinitions({ productId: 'sample' })).toEqual([
      expect.objectContaining({
        key: 'sample.outputQuality',
        ownerType: 'product',
        ownerId: 'sample',
      }),
    ]);
  });

  it('applies catalog defaults while normalizing plan features', () => {
    expect(
      normalizePlanFeaturesForStorage({ 'sample.other': true }, { productId: 'sample' })
    ).toEqual({
      'sample.other': true,
      'sample.outputQuality': 'hd',
    });
  });

  it('defaults to host product definitions instead of mixing every product', () => {
    expect(listPlanCapabilityDefinitions()).toEqual([]);
  });

  it('rejects missing required capabilities without defaults', () => {
    mocks.listRuntimeProducts.mockReturnValue([
      {
        id: 'ploykit',
        name: 'PloyKit',
        planCapabilities: [],
      },
      {
        id: 'sample',
        name: 'Sample',
        planCapabilities: [capability({ defaultValue: undefined })],
      },
    ]);

    expect(() => normalizePlanFeaturesForStorage({}, { productId: 'sample' })).toThrow(
      /Plan capabilities failed schema validation/
    );
  });
});
