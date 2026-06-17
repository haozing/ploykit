import type { CommercialSubject, ModuleUser, PermissionValue } from '@ploykit/module-sdk';
import type { ModuleRuntimeAccessSession } from './session';

export interface StaticModuleApiKeyRecord {
  key: string;
  id?: string;
  user: ModuleUser | null;
  productId?: string;
  environmentId?: string | null;
  workspaceId?: string;
  moduleId?: string;
  subject?: CommercialSubject;
  permissions?: readonly PermissionValue[];
  entitlements?: readonly string[];
  plans?: readonly string[];
  serviceConnections?: readonly string[];
  expiresAt?: Date;
  revoked?: boolean;
}

export interface StaticModuleApiKeyVerificationInput {
  apiKey: string;
  moduleId?: string;
  productId?: string;
  environmentId?: string | null;
  workspaceId?: string;
}

export interface StaticModuleApiKeyVerificationResult {
  ok: boolean;
  session?: Partial<ModuleRuntimeAccessSession>;
}

export function createStaticModuleApiKeyVerifier(records: readonly StaticModuleApiKeyRecord[]) {
  return (input: StaticModuleApiKeyVerificationInput): StaticModuleApiKeyVerificationResult => {
    const record = records.find((candidate) => candidate.key === input.apiKey);
    if (!record || record.revoked || (record.expiresAt && record.expiresAt <= new Date())) {
      return { ok: false };
    }
    if (record.moduleId && input.moduleId && record.moduleId !== input.moduleId) {
      return { ok: false };
    }
    if (record.productId && input.productId && record.productId !== input.productId) {
      return { ok: false };
    }
    if (
      record.environmentId !== undefined &&
      record.environmentId !== null &&
      input.environmentId !== undefined &&
      record.environmentId !== input.environmentId
    ) {
      return { ok: false };
    }
    if (record.workspaceId && input.workspaceId && record.workspaceId !== input.workspaceId) {
      return { ok: false };
    }

    return {
      ok: true,
      session: {
        user: record.user,
        productId: record.productId,
        environmentId: record.environmentId,
        workspaceId: record.workspaceId,
        userId: record.user?.id,
        actorId: record.user?.id,
        authKind: 'apiKey',
        apiKeyId: record.id,
        subject: record.subject ?? (record.user ? { type: 'user', id: record.user.id } : undefined),
        permissions: record.permissions,
        entitlements: record.entitlements,
        plans: record.plans,
        serviceConnections: record.serviceConnections,
      },
    };
  };
}
