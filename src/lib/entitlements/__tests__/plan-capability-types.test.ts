import { describe, expect, it } from 'vitest';
import {
  getPlanCapabilityLabel,
  normalizePlanCapabilityDefinition,
  parsePlanCapabilityValue,
  validatePlanCapabilityValueSet,
} from '../plan-capability-types';

describe('plan capability definitions', () => {
  it('normalizes product-scoped enum capability definitions', () => {
    const definition = normalizePlanCapabilityDefinition(
      {
        key: 'runlynk.outputQuality',
        valueType: 'enum',
        required: true,
        defaultValue: '1080p',
        label: { en: 'Output Quality', zh: '输出质量' },
        options: [{ value: '720p' }, { value: '1080p' }],
      },
      { ownerType: 'product', ownerId: 'runlynk', source: 'catalog.json' }
    );

    expect(definition).toMatchObject({
      key: 'runlynk.outputQuality',
      ownerType: 'product',
      ownerId: 'runlynk',
      valueType: 'enum',
      required: true,
      defaultValue: '1080p',
    });
    expect(getPlanCapabilityLabel(definition, 'zh-CN')).toBe('输出质量');
  });

  it('rejects enum defaults that are not declared options', () => {
    expect(() =>
      normalizePlanCapabilityDefinition(
        {
          key: 'runlynk.outputQuality',
          valueType: 'enum',
          defaultValue: 'original',
          options: [{ value: '1080p' }],
        },
        { ownerType: 'product', ownerId: 'runlynk' }
      )
    ).toThrow(/invalid defaultValue/);
  });

  it('coerces supported values and reports schema issues', () => {
    const quality = normalizePlanCapabilityDefinition(
      {
        key: 'runlynk.outputQuality',
        valueType: 'enum',
        required: true,
        options: [{ value: '720p' }, { value: '1080p' }],
      },
      { ownerType: 'product', ownerId: 'runlynk' }
    );
    const batchSize = normalizePlanCapabilityDefinition(
      {
        key: 'runlynk.batchSize',
        valueType: 'number',
      },
      { ownerType: 'product', ownerId: 'runlynk' }
    );

    expect(parsePlanCapabilityValue(batchSize, '12')).toEqual({
      success: true,
      value: 12,
    });

    const valid = validatePlanCapabilityValueSet(
      [quality, batchSize],
      {
        'runlynk.outputQuality': '1080p',
        'runlynk.batchSize': '8',
      },
      { requireAll: true }
    );
    expect(valid).toMatchObject({
      success: true,
      values: {
        'runlynk.outputQuality': '1080p',
        'runlynk.batchSize': 8,
      },
    });

    const invalid = validatePlanCapabilityValueSet(
      [quality, batchSize],
      {
        'runlynk.batchSize': 'many',
      },
      { requireAll: true }
    );
    expect(invalid.success).toBe(false);
    expect(invalid.issues).toEqual([
      expect.objectContaining({ key: 'runlynk.outputQuality', code: 'required' }),
      expect.objectContaining({ key: 'runlynk.batchSize', code: 'invalidNumber' }),
    ]);
  });
});
