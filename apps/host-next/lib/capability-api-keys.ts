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
import { DEFAULT_HOST_PRODUCT_ID, defaultProductId } from './default-scope';

function createHostApiKeySecret(): string {
  return `pk_${randomBytes(24).toString('base64url')}`;
}

function hashHostApiKey(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hostApiKeyPrefix(value: string): string {
  return value.slice(0, 12);
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
): 'active' | 'revoked' | 'expired' {
  if (record.status === 'revoked' || record.revokedAt) {
    return 'revoked';
  }
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= now.getTime()) {
    return 'expired';
  }
  return 'active';
}

function apiKeyScopeMatches(
  record: RuntimeStoreApiKeyRecord,
  scope: { productId?: string; workspaceId?: string | null; moduleId?: string }
): boolean {
  const productId = defaultProductId(scope.productId);
  if (record.productId && record.productId !== productId) {
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
  currentWorkspaceId: string | null;
  productId: string;
  workspaceId: string | null | undefined;
  moduleId: string | null | undefined;
}): void {
  if (input.productId !== input.currentProductId) {
    throw new Error(`MODULE_API_KEY_PRODUCT_SCOPE_DENIED: ${input.productId}`);
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
  currentWorkspaceId: string | null;
  record: RuntimeStoreApiKeyRecord;
}): void {
  if (
    input.record.productId !== input.currentProductId ||
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
  workspaceId?: string | null;
  moduleId?: string;
}): Promise<RuntimeStoreApiKeyRecord | null> {
  const prefix = hostApiKeyPrefix(input.apiKey);
  const keyHash = hashHostApiKey(input.apiKey);
  const record = await input.store.findApiKeyByHash({
    productId: input.productId,
    prefix,
    keyHash,
  });
  if (!record || effectiveApiKeyStatus(record) !== 'active') {
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
  const workspaceId = input.session.workspaceId ?? null;

  async function getRecord(id: string): Promise<RuntimeStoreApiKeyRecord> {
    const record = await input.store.getApiKey({
      productId,
      id,
    });
    if (!record || record.productId !== productId) {
      throw new Error(`MODULE_API_KEY_NOT_FOUND: ${id}`);
    }
    assertApiKeyRecordManageable({
      contract: input.contract,
      currentProductId: productId,
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
        workspaceId: createInput.scope?.workspaceId ?? workspaceId,
        moduleId: createInput.scope?.moduleId ?? input.contract.id,
      };
      assertApiKeyCreateScopeAllowed({
        contract: input.contract,
        currentProductId: productId,
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
        workspaceId: requestedScope.workspaceId,
        moduleId: requestedScope.moduleId,
        name: createInput.name,
        prefix: hostApiKeyPrefix(key),
        keyHash: hashHostApiKey(key),
        ...apiKeyOwnerFields(owner),
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
      const key = createHostApiKeySecret();
      const record = await input.store.updateApiKey(existing.id, {
        prefix: hostApiKeyPrefix(key),
        keyHash: hashHostApiKey(key),
        status: 'active',
        revokedAt: null,
      });
      await input.store.recordAudit({
        productId,
        workspaceId,
        moduleId: input.contract.id,
        actorId: input.session.actorId ?? input.session.userId ?? input.session.user?.id,
        type: 'api_key.rotated',
        metadata: { apiKeyId: record.id, prefix: record.prefix },
      });
      return { id: record.id, key, prefix: record.prefix };
    },
    async revoke(revokeInput) {
      const existing = await getRecord(revokeInput.id);
      const record = await input.store.updateApiKey(existing.id, {
        status: 'revoked',
        revokedAt: new Date().toISOString(),
        metadata: {
          ...existing.metadata,
          revokeReason: revokeInput.reason,
        },
      });
      await input.store.recordAudit({
        productId,
        workspaceId,
        moduleId: input.contract.id,
        actorId: input.session.actorId ?? input.session.userId ?? input.session.user?.id,
        type: 'api_key.revoked',
        metadata: { apiKeyId: record.id, prefix: record.prefix, reason: revokeInput.reason },
      });
      return { id: record.id, revoked: true };
    },
    async list(listInput = {}) {
      const records = await input.store.listApiKeys({ productId });
      return records
        .filter((record) =>
          apiKeyScopeMatches(record, { productId, workspaceId, moduleId: input.contract.id })
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
        workspaceId: record.workspaceId ?? undefined,
        authKind: 'apiKey',
        apiKeyId: record.id,
        subject: apiKeyOwnerFromRecord(record),
        permissions: record.permissions as readonly PermissionValue[],
      },
    };
  };
}
