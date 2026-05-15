import { describe, expect, it } from 'vitest';
import {
  internalServiceBindingActionSchema,
  internalServiceLogsRetentionSchema,
  resourceBindingAdminActionSchema,
} from '../internal-services.server';

describe('internal service admin schemas', () => {
  it('accepts a minimal host-managed binding upsert payload', () => {
    const parsed = internalServiceBindingActionSchema.parse({
      action: 'upsert',
      pluginId: 'sample-internal',
      serviceName: 'core-api',
      baseUrl: 'https://core.example.test',
      authType: 'bearer',
      authSecretRef: 'env:CORE_API_TOKEN',
      actorClaimsEnabled: true,
      actorClaimsAudience: 'core-api',
      actorClaimsSecretRef: 'env:CORE_ACTOR_SECRET',
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
      internalServiceBindingActionSchema.parse({
        action: 'upsert',
        pluginId: 'sample-internal',
        serviceName: 'core-api',
        baseUrl: 'https://core.example.test',
        actorClaimsType: 'jwt',
      })
    ).toThrow();
  });

  it('accepts service call log retention input', () => {
    expect(internalServiceLogsRetentionSchema.parse({ retentionDays: 30 })).toEqual({
      retentionDays: 30,
    });
  });

  it('requires secrets for auth and actor claims policy', async () => {
    const { handleInternalServiceBindingAction } = await import('../internal-services.server');

    await expect(
      handleInternalServiceBindingAction(
        internalServiceBindingActionSchema.parse({
          action: 'upsert',
          pluginId: 'sample-internal',
          serviceName: 'core-api',
          baseUrl: 'https://core.example.test',
          authType: 'bearer',
        })
      )
    ).rejects.toThrow(/require a secret/i);
  });
});
