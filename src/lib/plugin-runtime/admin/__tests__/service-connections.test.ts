import { describe, expect, it } from 'vitest';
import {
  serviceConnectionActionSchema,
  serviceConnectionListQuerySchema,
  serviceConnectionLogsQuerySchema,
  serviceConnectionLogsRetentionSchema,
  serviceConnectionRequirementsQuerySchema,
  resourceBindingAdminActionSchema,
} from '../service-connections.server';

describe('service connection admin schemas', () => {
  it('accepts a minimal host-managed connection upsert payload', () => {
    const parsed = serviceConnectionActionSchema.parse({
      action: 'upsert',
      pluginId: 'sample-internal',
      serviceName: 'core-api',
      baseUrl: 'https://core.example.test',
      authType: 'bearer',
      authSecretSource: { type: 'env', name: 'CORE_API_TOKEN' },
      actorClaimsEnabled: true,
      actorClaimsAudience: 'core-api',
      actorClaimsSecretSource: { type: 'env', name: 'CORE_ACTOR_SECRET' },
    });

    expect(parsed).toMatchObject({
      action: 'upsert',
      scopeType: 'global',
      authType: 'bearer',
      actorClaimsType: 'hmac',
      timeoutMs: 30000,
    });
  });

  it('accepts resource binding status actions for host operations', () => {
    expect(
      resourceBindingAdminActionSchema.parse({
        action: 'setStatus',
        id: 'binding-1',
        status: 'archived',
      })
    ).toMatchObject({ status: 'archived' });
  });

  it('keeps actor claims on the hmac contract for this V1', () => {
    expect(() =>
      serviceConnectionActionSchema.parse({
        action: 'upsert',
        pluginId: 'sample-internal',
        serviceName: 'core-api',
        baseUrl: 'https://core.example.test',
        actorClaimsType: 'jwt',
      })
    ).toThrow();
  });

  it('accepts service connection log retention input', () => {
    expect(serviceConnectionLogsRetentionSchema.parse({ retentionDays: 30 })).toEqual({
      retentionDays: 30,
    });
  });

  it('keeps connection, requirement, and log filter contracts separate', () => {
    expect(
      serviceConnectionListQuerySchema.parse({
        pluginId: 'sample-internal',
        serviceName: 'core-api',
        status: 'active',
        workspaceId: 'workspace-1',
        environment: 'staging',
      })
    ).toMatchObject({
      pluginId: 'sample-internal',
      serviceName: 'core-api',
      status: 'active',
      workspaceId: 'workspace-1',
      environment: 'staging',
    });

    expect(
      serviceConnectionRequirementsQuerySchema.parse({
        pluginId: 'sample-internal',
        serviceName: 'core-api',
        workspaceId: 'workspace-1',
        environment: 'staging',
      })
    ).toMatchObject({
      pluginId: 'sample-internal',
      serviceName: 'core-api',
      workspaceId: 'workspace-1',
      environment: 'staging',
    });

    expect(() => serviceConnectionLogsQuerySchema.parse({ status: 'active' })).toThrow();
  });

  it('requires secrets for auth and actor claims policy', async () => {
    const { handleServiceConnectionAction } = await import('../service-connections.server');

    await expect(
      handleServiceConnectionAction(
        serviceConnectionActionSchema.parse({
          action: 'upsert',
          pluginId: 'sample-internal',
          serviceName: 'core-api',
          baseUrl: 'https://core.example.test',
          authType: 'bearer',
        })
      )
    ).rejects.toThrow(/require a secret source/i);
  });
});
