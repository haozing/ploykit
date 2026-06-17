import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type {
  VerifyModuleApiKeyHandler,
  VerifyModuleApiKeyInput,
} from '@/lib/module-runtime/adapters';
import type { ModuleRuntimeContract } from '@/lib/module-runtime/contract/types';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import type {
  RuntimeStore,
  RuntimeStoreApiKeyRecord,
} from '@/lib/module-runtime/stores/runtime-store-types';
import type { CommercialSubject, ModuleApiKeysApi, PermissionValue } from '@ploykit/module-sdk';
import {
  DEFAULT_HOST_ENVIRONMENT_ID,
  DEFAULT_HOST_PRODUCT_ID,
  defaultEnvironmentId,
  defaultProductId,
} from './default-scope';

function createHostApiKeySecret(): string {
  return `pk_${randomBytes(24).toString('base64url')}`;
}

function hashHostApiKey(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hostApiKeyPrefix(value: string): string {
  return value.slice(0, 12);
}

function apiKeyRotationGraceMs(): number {
  const raw = Number(process.env.PLOYKIT_API_KEY_ROTATION_GRACE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 24 * 60 * 60 * 1000;
}

function defaultApiKeyOwner(session: ModuleHostSession): CommercialSubject | undefined {
  const userId = session.userId ?? session.user?.id;
  if (userId) {
    return { type: 'user', id: userId };
  }
  if (session.workspaceId) {
    return { type: 'workspace', id: session.workspaceId };
  }
  return undefined;
}

function sameCommercialSubject(
  left: CommercialSubject | undefined,
  right: CommercialSubject | undefined
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.type === right.type && left.id === right.id;
}

function sessionCanOwnApiKeySubject(
  session: ModuleHostSession,
  owner: CommercialSubject | undefined
): boolean {
  if (!owner || session.system || session.user?.role === 'admin') {
    return true;
  }
  if (sameCommercialSubject(session.subject, owner)) {
    return true;
  }
  if (owner.type === 'user') {
    return Boolean((session.userId ?? session.user?.id) === owner.id);
  }
  if (owner.type === 'workspace') {
    return Boolean(session.workspaceId === owner.id);
  }
  if (owner.type === 'organization') {
    return Boolean(session.organizationId === owner.id);
  }
  if (owner.type === 'apiKey') {
    return Boolean(session.apiKeyId === owner.id);
  }
  return false;
}

function assertApiKeyOwnerAllowed(
  session: ModuleHostSession,
  owner: CommercialSubject | undefined
): void {
  if (sessionCanOwnApiKeySubject(session, owner)) {
    return;
  }
  throw new Error(
    `MODULE_API_KEY_OWNER_SCOPE_DENIED: ${owner?.type ?? 'none'}:${owner?.id ?? 'none'}`
  );
}

function effectiveApiKeyStatus(
  record: RuntimeStoreApiKeyRecord,
  now: Date = new Date()
): 'active' | 'rotating' | 'revoked' | 'expired' {
  if (record.status === 'revoked' || record.revokedAt) {
    return 'revoked';
  }
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= now.getTime()) {
    return 'expired';
  }
  if (record.status === 'rotating') {
    return 'rotating';
  }
  return 'active';
}

function apiKeyScopeMatches(
  record: RuntimeStoreApiKeyRecord,
  scope: {
    productId?: string;
    environmentId?: string | null;
    workspaceId?: string | null;
    moduleId?: string;
  }
): boolean {
  const productId = defaultProductId(scope.productId);
  const environmentId = defaultEnvironmentId(scope.environmentId);
  if (record.productId && record.productId !== productId) {
    return false;
  }
  if (
    record.environmentId !== undefined &&
    record.environmentId !== null &&
    record.environmentId !== environmentId
  ) {
    return false;
  }
  if (
    record.workspaceId !== undefined &&
    record.workspaceId !== null &&
    scope.workspaceId !== undefined &&
    scope.workspaceId !== null &&
    record.workspaceId !== scope.workspaceId
  ) {
    return false;
  }
  if (record.moduleId && scope.moduleId && record.moduleId !== scope.moduleId) {
    return false;
  }
  return true;
}

function apiKeyOwnerFromRecord(record: RuntimeStoreApiKeyRecord): CommercialSubject | undefined {
  if (!record.ownerSubjectType || !record.ownerSubjectId) {
    return undefined;
  }
  return { type: record.ownerSubjectType, id: record.ownerSubjectId };
}

function rotationRootId(record: RuntimeStoreApiKeyRecord): string {
  return typeof record.metadata.rotationRootId === 'string'
    ? record.metadata.rotationRootId
    : record.id;
}

function inRotationFamily(record: RuntimeStoreApiKeyRecord, rootId: string): boolean {
  return record.id === rootId || record.metadata.rotationRootId === rootId;
}

function apiKeyOwnerFields(owner: CommercialSubject | undefined): {
  ownerSubjectType?: RuntimeStoreApiKeyRecord['ownerSubjectType'];
  ownerSubjectId?: string;
} {
  return {
    ownerSubjectType: owner?.type,
    ownerSubjectId: owner?.id,
  };
}

function assertApiKeyPermissionsDeclared(
  contract: ModuleRuntimeContract,
  permissions: readonly PermissionValue[] | undefined
): void {
  if (!permissions || permissions.length === 0) {
    return;
  }
  const declared = new Set(contract.permissions ?? []);
  const undeclared = permissions.filter((permission) => !declared.has(permission));
  if (undeclared.length > 0) {
    throw new Error(`MODULE_API_KEY_PERMISSION_SCOPE_DENIED: ${undeclared.join(',')}`);
  }
}

function assertApiKeyCreateScopeAllowed(input: {
  contract: ModuleRuntimeContract;
  currentProductId: string;
  currentEnvironmentId: string;
  currentWorkspaceId: string | null;
  productId: string;
  environmentId: string | null | undefined;
  workspaceId: string | null | undefined;
  moduleId: string | null | undefined;
}): void {
  if (input.productId !== input.currentProductId) {
    throw new Error(`MODULE_API_KEY_PRODUCT_SCOPE_DENIED: ${input.productId}`);
  }
  if ((input.environmentId ?? null) !== input.currentEnvironmentId) {
    throw new Error(`MODULE_API_KEY_ENVIRONMENT_SCOPE_DENIED: ${input.environmentId ?? 'global'}`);
  }
  if ((input.workspaceId ?? null) !== input.currentWorkspaceId) {
    throw new Error(`MODULE_API_KEY_WORKSPACE_SCOPE_DENIED: ${input.workspaceId ?? 'global'}`);
  }
  if ((input.moduleId ?? null) !== input.contract.id) {
    throw new Error(`MODULE_API_KEY_MODULE_SCOPE_DENIED: ${input.moduleId ?? 'global'}`);
  }
}

function assertApiKeyRecordManageable(input: {
  contract: ModuleRuntimeContract;
  currentProductId: string;
  currentEnvironmentId: string;
  currentWorkspaceId: string | null;
  record: RuntimeStoreApiKeyRecord;
}): void {
  if (
    input.record.productId !== input.currentProductId ||
    (input.record.environmentId !== undefined &&
      input.record.environmentId !== null &&
      input.record.environmentId !== input.currentEnvironmentId) ||
    (input.record.workspaceId ?? null) !== input.currentWorkspaceId ||
    (input.record.moduleId ?? null) !== input.contract.id
  ) {
    throw new Error(`MODULE_API_KEY_SCOPE_DENIED: ${input.record.id}`);
  }
}

async function verifyStoredApiKey(input: {
  store: RuntimeStore;
  apiKey: string;
  productId?: string;
  environmentId?: string | null;
  workspaceId?: string | null;
  moduleId?: string;
}): Promise<RuntimeStoreApiKeyRecord | null> {
  const prefix = hostApiKeyPrefix(input.apiKey);
  const keyHash = hashHostApiKey(input.apiKey);
  const record = await input.store.findApiKeyByHash({
    productId: input.productId,
    environmentId: input.environmentId,
    prefix,
    keyHash,
  });
  const status = record ? effectiveApiKeyStatus(record) : 'revoked';
  if (!record || (status !== 'active' && status !== 'rotating')) {
    return null;
  }
  if (!apiKeyScopeMatches(record, input)) {
    return null;
  }
  return record;
}

export function createHostModuleApiKeysApi(input: {
  contract: ModuleRuntimeContract;
  store: RuntimeStore;
  session: ModuleHostSession;
}): ModuleApiKeysApi {
  const productId = defaultProductId(input.session.productId);
  const environmentId = defaultEnvironmentId(input.session.environmentId);
  const workspaceId = input.session.workspaceId ?? null;

  async function getRecord(id: string): Promise<RuntimeStoreApiKeyRecord> {
    const record = await input.store.getApiKey({
      productId,
      environmentId,
      id,
    });
    if (!record || record.productId !== productId) {
      throw new Error(`MODULE_API_KEY_NOT_FOUND: ${id}`);
    }
    assertApiKeyRecordManageable({
      contract: input.contract,
      currentProductId: productId,
      currentEnvironmentId: environmentId,
      currentWorkspaceId: workspaceId,
      record,
    });
    return record;
  }

  return {
    async create(createInput) {
      const key = createHostApiKeySecret();
      const owner = createInput.owner ?? defaultApiKeyOwner(input.session);
      const requestedScope = {
        productId: defaultProductId(createInput.scope?.productId ?? productId),
        environmentId: defaultEnvironmentId(createInput.scope?.environmentId ?? environmentId),
        workspaceId: createInput.scope?.workspaceId ?? workspaceId,
        moduleId: createInput.scope?.moduleId ?? input.contract.id,
      };
      assertApiKeyCreateScopeAllowed({
        contract: input.contract,
        currentProductId: productId,
        currentEnvironmentId: environmentId,
        currentWorkspaceId: workspaceId,
        ...requestedScope,
      });
      assertApiKeyOwnerAllowed(input.session, owner);
      assertApiKeyPermissionsDeclared(
        input.contract,
        createInput.permissions as readonly PermissionValue[] | undefined
      );
      const record = await input.store.createApiKey({
        id: `api_key_${randomUUID()}`,
        productId: requestedScope.productId,
        environmentId: requestedScope.environmentId,
        workspaceId: requestedScope.workspaceId,
        moduleId: requestedScope.moduleId,
        name: createInput.name,
        prefix: hostApiKeyPrefix(key),
        keyHash: hashHostApiKey(key),
        ...apiKeyOwnerFields(owner),
        createdBy: input.session.actorId ?? input.session.userId ?? input.session.user?.id,
        permissions: createInput.permissions as readonly PermissionValue[] | undefined,
        status: 'active',
        expiresAt: createInput.expiresAt,
        metadata: createInput.metadata ?? {},
      });
      await input.store.recordAudit({
        productId,
        workspaceId,
        moduleId: input.contract.id,
        actorId: input.session.actorId ?? input.session.userId ?? input.session.user?.id,
        type: 'api_key.created',
        metadata: {
          apiKeyId: record.id,
          prefix: record.prefix,
          owner: apiKeyOwnerFromRecord(record),
          scope: {
            productId: record.productId,
            environmentId: record.environmentId,
            workspaceId: record.workspaceId,
            moduleId: record.moduleId,
          },
        },
      });
      return {
        id: record.id,
        key,
        prefix: record.prefix,
        owner: apiKeyOwnerFromRecord(record),
        expiresAt: record.expiresAt,
      };
    },
    async rotate(rotateInput) {
      const existing = await getRecord(rotateInput.id);
      const status = effectiveApiKeyStatus(existing);
      if (status === 'revoked' || status === 'expired') {
        throw new Error(`MODULE_API_KEY_ROTATE_DENIED: ${existing.id}:${status}`);
      }
      const key = createHostApiKeySecret();
      const nextId = `api_key_${randomUUID()}`;
      const rootId = rotationRootId(existing);
      const graceExpiresAt = new Date(Date.now() + apiKeyRotationGraceMs()).toISOString();
      const existingExpiresAt =
        existing.expiresAt && new Date(existing.expiresAt).getTime() < new Date(graceExpiresAt).getTime()
          ? existing.expiresAt
          : graceExpiresAt;

      const rotateWithStore = async (store: RuntimeStore) => {
        const record = await store.createApiKey({
          id: nextId,
          productId: existing.productId,
          environmentId: existing.environmentId ?? null,
          workspaceId: existing.workspaceId ?? null,
          moduleId: existing.moduleId ?? null,
          name: existing.name,
          prefix: hostApiKeyPrefix(key),
          keyHash: hashHostApiKey(key),
          ownerSubjectType: existing.ownerSubjectType,
          ownerSubjectId: existing.ownerSubjectId,
          createdBy: input.session.actorId ?? input.session.userId ?? input.session.user?.id,
          permissions: existing.permissions,
          rateLimit: existing.rateLimit,
          status: 'active',
          expiresAt: existing.expiresAt,
          metadata: {
            ...existing.metadata,
            rotationRootId: rootId,
            rotatedFromId: existing.id,
          },
        });
        await store.updateApiKey(existing.id, {
          status: 'rotating',
          expiresAt: existingExpiresAt,
          metadata: {
            rotationRootId: rootId,
            rotatedToId: record.id,
            rotationGraceExpiresAt: existingExpiresAt,
          },
        });
        return record;
      };
      const record = input.store.transaction
        ? await input.store.transaction(rotateWithStore)
        : await rotateWithStore(input.store);
      await input.store.recordAudit({
        productId,
        workspaceId,
        moduleId: input.contract.id,
        actorId: input.session.actorId ?? input.session.userId ?? input.session.user?.id,
        type: 'api_key.rotated',
        metadata: {
          apiKeyId: record.id,
          rotatedFromId: existing.id,
          rotationRootId: rootId,
          prefix: record.prefix,
          graceExpiresAt: existingExpiresAt,
        },
      });
      return { id: record.id, key, prefix: record.prefix };
    },
    async revoke(revokeInput) {
      const existing = await getRecord(revokeInput.id);
      const rootId = rotationRootId(existing);
      const family = (await input.store.listApiKeys({ productId }))
        .filter((record) =>
          apiKeyScopeMatches(record, {
            productId,
            environmentId,
            workspaceId,
            moduleId: input.contract.id,
          })
        )
        .filter((record) => inRotationFamily(record, rootId));
      const revokedAt = new Date().toISOString();
      const revokeWithStore = async (store: RuntimeStore) => {
        for (const record of family.length > 0 ? family : [existing]) {
          await store.updateApiKey(record.id, {
            status: 'revoked',
            revokedAt,
            metadata: {
              revokeReason: revokeInput.reason,
              rotationRootId: rootId,
            },
          });
        }
      };
      if (input.store.transaction) {
        await input.store.transaction(revokeWithStore);
      } else {
        await revokeWithStore(input.store);
      }
      await input.store.recordAudit({
        productId,
        workspaceId,
        moduleId: input.contract.id,
        actorId: input.session.actorId ?? input.session.userId ?? input.session.user?.id,
        type: 'api_key.revoked',
        metadata: {
          apiKeyId: existing.id,
          apiKeyIds: (family.length > 0 ? family : [existing]).map((record) => record.id),
          prefix: existing.prefix,
          reason: revokeInput.reason,
        },
      });
      return { id: existing.id, revoked: true };
    },
    async list(listInput = {}) {
      const records = await input.store.listApiKeys({ productId });
      return records
        .filter((record) =>
          apiKeyScopeMatches(record, {
            productId,
            environmentId,
            workspaceId,
            moduleId: input.contract.id,
          })
        )
        .filter(
          (record) =>
            (record.workspaceId ?? null) === workspaceId &&
            (record.moduleId ?? null) === input.contract.id
        )
        .filter(
          (record) =>
            !listInput.owner ||
            sameCommercialSubject(apiKeyOwnerFromRecord(record), listInput.owner)
        )
        .map((record) => ({
          id: record.id,
          name: record.name,
          prefix: record.prefix,
          owner: apiKeyOwnerFromRecord(record),
          status: effectiveApiKeyStatus(record),
          lastUsedAt: record.lastUsedAt,
          expiresAt: record.expiresAt,
          metadata: record.metadata,
        }))
        .filter((record) => !listInput.status || record.status === listInput.status);
    },
    async verify(apiKey) {
      const record = await verifyStoredApiKey({
        store: input.store,
        apiKey,
        productId,
        environmentId,
        workspaceId,
        moduleId: input.contract.id,
      });
      if (!record) {
        return { ok: false };
      }
      await input.store.updateApiKey(record.id, {
        lastUsedAt: new Date().toISOString(),
      });
      return {
        ok: true,
        productId: record.productId,
        environmentId: record.environmentId ?? undefined,
        workspaceId: record.workspaceId ?? undefined,
        apiKeyId: record.id,
        subject: apiKeyOwnerFromRecord(record),
        permissions: record.permissions,
      };
    },
    async require(apiKey) {
      const result = await createHostModuleApiKeysApi(input).verify(apiKey);
      if (!result.ok) {
        throw new Error('MODULE_API_KEY_UNAUTHORIZED');
      }
      return { ...result, ok: true };
    },
  };
}

export function createHostModuleApiKeyVerifier(input: {
  store: RuntimeStore;
}): VerifyModuleApiKeyHandler {
  return async (verifyInput: VerifyModuleApiKeyInput) => {
    const record = await verifyStoredApiKey({
      store: input.store,
      apiKey: verifyInput.apiKey,
      productId: defaultProductId(verifyInput.session?.productId ?? DEFAULT_HOST_PRODUCT_ID),
      environmentId: defaultEnvironmentId(
        verifyInput.session?.environmentId ?? DEFAULT_HOST_ENVIRONMENT_ID
      ),
      workspaceId: undefined,
      moduleId: verifyInput.moduleId,
    });
    if (!record) {
      return {
        ok: false,
        status: 401,
        code: 'MODULE_API_KEY_UNAUTHORIZED',
        message: 'API key is not authorized for this module route.',
      };
    }
    await input.store.updateApiKey(record.id, {
      lastUsedAt: new Date().toISOString(),
    });
    return {
      ok: true,
      session: {
        user: null,
        productId: record.productId,
        environmentId: record.environmentId ?? undefined,
        workspaceId: record.workspaceId ?? undefined,
        authKind: 'apiKey',
        apiKeyId: record.id,
        subject: apiKeyOwnerFromRecord(record),
        permissions: record.permissions as readonly PermissionValue[],
      },
    };
  };
}
