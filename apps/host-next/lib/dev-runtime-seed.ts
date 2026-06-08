import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createHostPasswordHash } from './auth';
import type { HostRuntimeStoreHandle } from './runtime-store';
import type { ModuleWorkspaceRole } from '@ploykit/module-sdk';

interface DevRuntimeSeed {
  hostUsers?: Array<Record<string, unknown>>;
  memberships?: Array<Record<string, unknown>>;
  productScopeProducts?: Array<Record<string, unknown>>;
  productScopeWorkspaces?: Array<Record<string, unknown>>;
  productScopeDomainAliases?: Array<Record<string, unknown>>;
  productScopeInvites?: Array<Record<string, unknown>>;
  serviceConnections?: Array<Record<string, unknown>>;
  resourceBindings?: Array<Record<string, unknown>>;
}

const seedApplyState = new WeakMap<HostRuntimeStoreHandle, { path: string; fingerprint: string }>();

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function workspaceRoleValue(value: unknown, fallback: ModuleWorkspaceRole): ModuleWorkspaceRole {
  return value === 'owner' || value === 'admin' || value === 'editor' || value === 'viewer'
    ? value
    : fallback;
}

function seedFingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function applyHostDevRuntimeSeedInternal(
  runtimeStore: HostRuntimeStoreHandle,
  options: { force: boolean }
): Promise<void> {
  const seedFile = process.env.PLOYKIT_HOST_DEV_SEED_FILE;
  if (!seedFile || process.env.NODE_ENV === 'production') {
    return;
  }

  const resolvedPath = path.resolve(seedFile);
  const seedText = await fs.readFile(resolvedPath, 'utf8');
  const fingerprint = seedFingerprint(seedText);
  const state = seedApplyState.get(runtimeStore);
  if (
    !options.force &&
    state?.path === resolvedPath &&
    state.fingerprint === fingerprint
  ) {
    return;
  }

  const seed = JSON.parse(seedText) as DevRuntimeSeed;

  for (const product of arrayValue(seed.productScopeProducts)) {
    const id = stringValue(product.id);
    const name = stringValue(product.name);
    if (!id || !name) {
      continue;
    }
    const profile = stringValue(product.profile);
    await runtimeStore.store.upsertProductScopeProduct({
      id,
      name,
      profile:
        profile === 'explicit-workspace' || profile === 'domain-alias' || profile === 'hidden-default'
          ? profile
          : 'hidden-default',
      defaultWorkspaceId: stringValue(product.defaultWorkspaceId),
    });
  }

  for (const workspace of arrayValue(seed.productScopeWorkspaces)) {
    const id = stringValue(workspace.id);
    const productId = stringValue(workspace.productId);
    const name = stringValue(workspace.name);
    const slug = stringValue(workspace.slug);
    if (!id || !productId || !name || !slug) {
      continue;
    }
    await runtimeStore.store.upsertProductScopeWorkspace({
      id,
      productId,
      name,
      slug,
      domainAliases: Array.isArray(workspace.domainAliases)
        ? workspace.domainAliases.filter((alias): alias is string => typeof alias === 'string')
        : undefined,
    });
  }

  for (const alias of arrayValue(seed.productScopeDomainAliases)) {
    const hostname = stringValue(alias.hostname);
    const productId = stringValue(alias.productId);
    if (!hostname || !productId) {
      continue;
    }
    await runtimeStore.store.upsertProductScopeDomainAlias({
      hostname,
      productId,
      workspaceId: stringValue(alias.workspaceId),
    });
  }

  for (const invite of arrayValue(seed.productScopeInvites)) {
    const id = stringValue(invite.id);
    const productId = stringValue(invite.productId);
    const workspaceId = stringValue(invite.workspaceId);
    const email = stringValue(invite.email);
    const token = stringValue(invite.token);
    const expiresAt = stringValue(invite.expiresAt);
    if (!id || !productId || !workspaceId || !email || !token || !expiresAt) {
      continue;
    }
    const status = stringValue(invite.status);
    await runtimeStore.store.upsertProductScopeInvite({
      id,
      productId,
      workspaceId,
      email,
      role: workspaceRoleValue(invite.role, 'viewer'),
      status:
        status === 'accepted' || status === 'revoked' || status === 'expired'
          ? status
          : 'pending',
      token,
      expiresAt,
      invitedBy: stringValue(invite.invitedBy),
      acceptedBy: stringValue(invite.acceptedBy),
    });
  }

  for (const user of arrayValue(seed.hostUsers)) {
    const id = stringValue(user.id);
    const email = stringValue(user.email);
    if (!id || !email) {
      continue;
    }
    const password = stringValue(user.password) ?? 'Admin@123456';
    await runtimeStore.store.upsertHostUser({
      id,
      email,
      passwordHash: createHostPasswordHash(password, stringValue(user.salt) ?? `dev-seed-${id}`),
      role: user.role === 'admin' ? 'admin' : 'user',
      status: user.status === 'suspended' || user.status === 'deleted' ? user.status : 'active',
      productId: stringValue(user.productId) ?? 'demo-product',
      workspaceId: stringValue(user.workspaceId) ?? 'demo-workspace',
      workspaceRole: workspaceRoleValue(user.workspaceRole, 'owner'),
      metadata: {
        ...recordValue(user.metadata),
        devSeedFile: resolvedPath,
      },
    });
  }

  for (const membership of arrayValue(seed.memberships)) {
    const productId = stringValue(membership.productId);
    const workspaceId = stringValue(membership.workspaceId);
    const userId = stringValue(membership.userId);
    if (!productId || !workspaceId || !userId) {
      continue;
    }
    await runtimeStore.store.upsertMembership({
      productId,
      workspaceId,
      userId,
      role: workspaceRoleValue(membership.role, 'owner'),
      status: membership.status === 'disabled' ? 'disabled' : 'active',
    });
  }

  for (const connection of arrayValue(seed.serviceConnections)) {
    const productId = stringValue(connection.productId);
    const connectionId = stringValue(connection.connectionId);
    const service = stringValue(connection.service);
    const provider = stringValue(connection.provider);
    if (!productId || !connectionId || !service || !provider) {
      continue;
    }
    await runtimeStore.store.upsertServiceConnection({
      productId,
      workspaceId: stringValue(connection.workspaceId) ?? null,
      moduleId: stringValue(connection.moduleId) ?? null,
      actorId: stringValue(connection.actorId) ?? null,
      connectionId,
      service,
      provider,
      status: connection.status === 'disabled' ? 'disabled' : 'active',
      environment: stringValue(connection.environment),
      ownerType: stringValue(connection.ownerType),
      scopeType: stringValue(connection.scopeType),
      authType: stringValue(connection.authType),
      config: recordValue(connection.config),
      secretRefs: Object.fromEntries(
        Object.entries(recordValue(connection.secretRefs)).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
      ),
      health: recordValue(connection.health),
      metadata: {
        ...recordValue(connection.metadata),
        devSeedFile: resolvedPath,
      },
    });
  }

  for (const binding of arrayValue(seed.resourceBindings)) {
    const productId = stringValue(binding.productId);
    const name = stringValue(binding.name);
    if (!productId || !name) {
      continue;
    }
    await runtimeStore.store.upsertResourceBinding({
      productId,
      workspaceId: stringValue(binding.workspaceId) ?? null,
      moduleId: stringValue(binding.moduleId) ?? null,
      actorId: stringValue(binding.actorId) ?? null,
      name,
      kind: stringValue(binding.kind),
      value: binding.value,
      status: binding.status === 'disabled' ? 'disabled' : 'active',
      metadata: {
        ...recordValue(binding.metadata),
        devSeedFile: resolvedPath,
      },
    });
  }

  seedApplyState.set(runtimeStore, { path: resolvedPath, fingerprint });
}

export async function applyHostDevRuntimeSeed(
  runtimeStore: HostRuntimeStoreHandle
): Promise<void> {
  await applyHostDevRuntimeSeedInternal(runtimeStore, { force: true });
}

export async function applyHostDevRuntimeSeedIfChanged(
  runtimeStore: HostRuntimeStoreHandle
): Promise<void> {
  await applyHostDevRuntimeSeedInternal(runtimeStore, { force: false });
}
