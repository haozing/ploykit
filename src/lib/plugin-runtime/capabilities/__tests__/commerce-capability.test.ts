import { describe, expect, it, vi } from 'vitest';
import { definePlugin, Permission, type PermissionValue } from '@ploykit/plugin-sdk';
import { normalizePluginRuntimeContract } from '../../contract';
import { createPluginRuntimeContext } from '../../context';
import type { PluginCommerceHost } from '..';

function createContext(permissions: PermissionValue[], host: Partial<PluginCommerceHost>) {
  return createPluginRuntimeContext({
    contract: normalizePluginRuntimeContract(
      definePlugin({
        id: 'commerce-test',
        name: 'Commerce Test',
        version: '1.0.0',
        permissions,
      })
    ),
    request: new Request('https://test.local/api/plugins/commerce-test/commerce'),
    requestId: 'request-1',
    user: { id: 'user-1', role: 'user', email: 'user@example.test' },
    capabilities: {
      commerce: { host },
    },
  });
}

describe('commerce capability', () => {
  it('creates generic one-time orders with plugin credit metadata', async () => {
    const createOrder = vi.fn<PluginCommerceHost['createOrder']>(async (_scope, input) => ({
      id: 'order-1',
      orderType: input.orderType ?? 'one_time_purchase',
      provider: input.provider ?? 'local',
      providerOrderId: input.providerOrderId ?? 'local:order-1',
      amount: input.amount === undefined ? null : String(input.amount),
      currency: input.currency ?? 'USD',
      status: input.status ?? 'succeeded',
      planId: null,
      relatedOrderId: null,
      metadata: input.metadata,
      createdAt: new Date('2026-05-18T00:00:00Z'),
      updatedAt: new Date('2026-05-18T00:00:00Z'),
    }));
    const context = createContext([Permission.CommerceWrite], { createOrder });

    await expect(
      context.commerce.createOrder({
        amount: 25,
        currency: 'USD',
        creditAmount: 10,
        entitlementKey: 'license.pro',
        metadata: { source: 'plugin-test' },
      })
    ).resolves.toMatchObject({
      id: 'order-1',
      orderType: 'one_time_purchase',
      provider: 'local',
      amount: '25',
      status: 'succeeded',
    });
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: 'commerce-test',
        userId: 'user-1',
      }),
      expect.objectContaining({
        creditAmount: 10,
        creditMetric: 'platform.credits',
        entitlementKey: 'license.pro',
        metadata: expect.objectContaining({
          pluginId: 'commerce-test',
          source: 'plugin-test',
          entitlementKey: 'license.pro',
          creditAmount: 10,
          creditMetric: 'platform.credits',
          creditScopeType: 'user',
          creditScopeId: 'user-1',
        }),
      })
    );
  });

  it('gates read and write operations independently', async () => {
    const readOnly = createContext([Permission.CommerceRead], {});
    const writeOnly = createContext([Permission.CommerceWrite], {});

    await expect(
      readOnly.commerce.createOrder({ amount: 1, currency: 'USD' })
    ).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: {
        permission: Permission.CommerceWrite,
        capability: 'ctx.commerce.createOrder',
      },
    });
    await expect(writeOnly.commerce.getOrder('order-1')).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: {
        permission: Permission.CommerceRead,
        capability: 'ctx.commerce.getOrder',
      },
    });
  });
});
