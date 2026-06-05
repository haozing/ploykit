import fs from 'node:fs/promises';
import path from 'node:path';
import { createHostPasswordHash } from './auth';
import type { HostRuntimeStoreHandle } from './runtime-store';
import type { ModuleWorkspaceRole } from '@ploykit/module-sdk';

interface DevRuntimeSeed {
  hostUsers?: Array<Record<string, unknown>>;
  memberships?: Array<Record<string, unknown>>;
  serviceConnections?: Array<Record<string, unknown>>;
  resourceBindings?: Array<Record<string, unknown>>;
}

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

export async function applyHostDevRuntimeSeed(
  runtimeStore: HostRuntimeStoreHandle
): Promise<void> {
  const seedFile = process.env.PLOYKIT_HOST_DEV_SEED_FILE;
  if (!seedFile || process.env.NODE_ENV === 'production') {
    return;
  }

  const resolvedPath = path.resolve(seedFile);
  const seed = JSON.parse(await fs.readFile(resolvedPath, 'utf8')) as DevRuntimeSeed;

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
}
