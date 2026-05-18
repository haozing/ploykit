import { describe, expect, it, vi } from 'vitest';
import { definePlugin, Permission, type PermissionValue } from '@ploykit/plugin-sdk';
import { normalizePluginRuntimeContract } from '../../contract';
import { createPluginRuntimeContext } from '../../context';
import type { PluginCreditsHost } from '..';

function createContract(permissions: PermissionValue[] = []) {
  return normalizePluginRuntimeContract(
    definePlugin({
      id: 'credit-test',
      name: 'Credit Test',
      version: '1.0.0',
      permissions,
    })
  );
}

function createContext(permissions: PermissionValue[], host: Partial<PluginCreditsHost>) {
  return createPluginRuntimeContext({
    contract: createContract(permissions),
    request: new Request('https://test.local/api/plugins/credit-test/credits'),
    requestId: 'request-1',
    user: { id: 'user-1', role: 'user' },
    capabilities: {
      credits: { host },
    },
  });
}

describe('credits capability', () => {
  it('reads the default user-scoped platform credit balance', async () => {
    const getBalance = vi.fn<PluginCreditsHost['getBalance']>(async (_scope, input) => ({
      balance: 42,
      metric: input.metric,
      scope: input.accountScope,
      userId: input.accountScope.type === 'user' ? input.accountScope.id : undefined,
    }));
    const context = createContext([Permission.CreditsRead], { getBalance });

    await expect(context.credits.getBalance()).resolves.toEqual({
      balance: 42,
      metric: 'platform.credits',
      scope: { type: 'user', id: 'user-1' },
      userId: 'user-1',
    });
    expect(getBalance).toHaveBeenCalledWith(
      expect.objectContaining({ pluginId: 'credit-test', userId: 'user-1' }),
      { accountScope: { type: 'user', id: 'user-1' }, metric: 'platform.credits' }
    );
  });

  it('consumes plugin-namespaced credits through the resolved ledger scope', async () => {
    const consume = vi.fn<PluginCreditsHost['consume']>(async (_scope, input) => ({
      consumed: true,
      amount: input.amount,
      balanceBefore: 10,
      balanceAfter: 7,
      meter: input.meter,
      metric: input.metric,
      scope: input.accountScope,
      userId:
        input.userId ?? (input.accountScope.type === 'user' ? input.accountScope.id : undefined),
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    }));
    const context = createContext([Permission.CreditsConsume], { consume });

    await expect(
      context.credits.consume({
        meter: 'credit-test.external-api',
        amount: 3,
        idempotencyKey: 'credit-call-1',
        metadata: { provider: 'example' },
      })
    ).resolves.toEqual({
      consumed: true,
      amount: 3,
      balanceBefore: 10,
      balanceAfter: 7,
      meter: 'credit-test.external-api',
      metric: 'platform.credits',
      scope: { type: 'user', id: 'user-1' },
      userId: 'user-1',
      idempotencyKey: 'credit-call-1',
      metadata: { provider: 'example' },
    });
  });

  it('supports grant, delta adjust, set adjust, and refund as generic write operations', async () => {
    let balance = 10;
    const change = (
      operation: 'grant' | 'adjust' | 'refund',
      input: Parameters<PluginCreditsHost['grant']>[1]
    ) => {
      const balanceBefore = balance;
      const amount = input.amount;
      if (operation === 'adjust' && 'mode' in input && input.mode === 'set') {
        balance = amount;
      } else {
        balance += amount;
      }
      return {
        changed: true as const,
        operation,
        amount,
        balanceBefore,
        balanceAfter: balance,
        metric: input.metric,
        scope: input.accountScope,
        userId: input.accountScope.type === 'user' ? input.accountScope.id : undefined,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      };
    };
    const grant = vi.fn<PluginCreditsHost['grant']>(async (_scope, input) =>
      change('grant', input)
    );
    const adjust = vi.fn<PluginCreditsHost['adjust']>(async (_scope, input) =>
      change('adjust', input)
    );
    const refund = vi.fn<PluginCreditsHost['refund']>(async (_scope, input) =>
      change('refund', input)
    );
    const context = createContext([Permission.CreditsWrite], { grant, adjust, refund });

    await expect(context.credits.grant({ amount: 5, reason: 'seed' })).resolves.toMatchObject({
      operation: 'grant',
      balanceBefore: 10,
      balanceAfter: 15,
    });
    await expect(context.credits.adjust({ amount: -2 })).resolves.toMatchObject({
      operation: 'adjust',
      balanceBefore: 15,
      balanceAfter: 13,
    });
    await expect(context.credits.adjust({ amount: 20, mode: 'set' })).resolves.toMatchObject({
      operation: 'adjust',
      balanceBefore: 13,
      balanceAfter: 20,
    });
    await expect(context.credits.refund({ amount: 4 })).resolves.toMatchObject({
      operation: 'refund',
      balanceBefore: 20,
      balanceAfter: 24,
    });
  });

  it('rejects write operations without CreditsWrite', async () => {
    const context = createContext([Permission.CreditsRead], {});

    await expect(context.credits.grant({ amount: 1 })).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: {
        permission: Permission.CreditsWrite,
        capability: 'ctx.credits.grant',
      },
    });
  });
});
