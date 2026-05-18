import { describe, expect, it } from 'vitest';
import { DbPluginServiceConnectionRegistry } from '../services-capability.server';

function row(input: {
  id: string;
  ownerType: 'plugin' | 'suite' | 'product';
  ownerId: string;
  scopeType: 'global' | 'workspace';
  scopeId?: string | null;
}) {
  return {
    id: input.id,
    productId: 'product-a',
    pluginId: 'plugin-a',
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    serviceName: 'core-api',
    scopeType: input.scopeType,
    scopeId: input.scopeId ?? null,
    environment: null,
    status: 'active',
    baseUrl: 'https://core.example.test',
    authType: 'none',
    authSecretRef: null,
    authUsernameRef: null,
    authPasswordRef: null,
    authHeaderName: null,
    actorClaimsEnabled: false,
    actorClaimsType: 'hmac',
    actorClaimsAudience: null,
    actorClaimsSecretRef: null,
    actorClaimsKeyId: null,
    actorClaimsPreviousSecretRef: null,
    actorClaimsPreviousKeyId: null,
    actorClaimsTtlSeconds: 60,
    timeoutMs: 30000,
    retryAttempts: 0,
    retryBackoffMs: 250,
    maxResponseBytes: 10485760,
    healthPath: null,
    healthMethod: 'GET',
    healthExpectedStatus: 200,
    lastHealthStatus: null,
    lastHealthCheckedAt: null,
    lastHealthError: null,
    metadata: {},
    createdByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function registryWithRows(rows: unknown[]) {
  const executor = {
    select() {
      return {
        from() {
          return {
            where: async () => rows,
          };
        },
      };
    },
  };
  return new DbPluginServiceConnectionRegistry(executor as never);
}

describe('DbPluginServiceConnectionRegistry', () => {
  it('prefers workspace overrides before plugin/suite/product owner defaults', async () => {
    const registry = registryWithRows([
      row({ id: 'plugin-global', ownerType: 'plugin', ownerId: 'plugin-a', scopeType: 'global' }),
      row({
        id: 'product-workspace',
        ownerType: 'product',
        ownerId: 'product-a',
        scopeType: 'workspace',
        scopeId: 'workspace-a',
      }),
    ]);

    await expect(
      registry.resolveBinding({
        pluginId: 'plugin-a',
        productId: 'product-a',
        suiteId: 'suite-a',
        serviceName: 'core-api',
        workspaceId: 'workspace-a',
        status: 'active',
      })
    ).resolves.toMatchObject({ id: 'product-workspace' });
  });
});
