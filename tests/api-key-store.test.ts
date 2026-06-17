import assert from 'node:assert/strict';
import test from 'node:test';
import { Permission } from '@ploykit/module-sdk';
import { createInMemoryRuntimeStore, type ModuleRuntimeContract } from '../src/lib/module-runtime';
import type { ModuleHostSession } from '../src/lib/module-runtime/host/session';
import {
  createHostModuleApiKeyVerifier,
  createHostModuleApiKeysApi,
} from '../apps/host-next/lib/capability-providers';
import {
  DEFAULT_HOST_ENVIRONMENT_ID,
  DEFAULT_HOST_PRODUCT_ID,
  DEFAULT_HOST_WORKSPACE_ID,
} from '../apps/host-next/lib/default-scope';

test('host API keys use runtime store hashes and produce machine access sessions', async () => {
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-19T10:00:00.000Z'),
  });
  const contract = {
    id: 'api-key-tool',
    permissions: [Permission.ApiKeysWrite, Permission.ApiKeysRead, Permission.CreditsRead],
  } as unknown as ModuleRuntimeContract;
  const session = {
    productId: DEFAULT_HOST_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    user: { id: 'owner-1', role: 'admin' },
    userId: 'owner-1',
    actorId: 'owner-1',
    authKind: 'user',
  } as ModuleHostSession;
  const apiKeys = createHostModuleApiKeysApi({ contract, store, session });

  const created = await apiKeys.create({
    name: 'Worker key',
    owner: { type: 'workspace', id: DEFAULT_HOST_WORKSPACE_ID },
    scope: {
      productId: DEFAULT_HOST_PRODUCT_ID,
      workspaceId: DEFAULT_HOST_WORKSPACE_ID,
      moduleId: contract.id,
    },
    permissions: [Permission.CreditsRead],
  });
  assert.ok(created.key?.startsWith('pk_'));

  const stored = (await store.listApiKeys({ productId: DEFAULT_HOST_PRODUCT_ID }))[0]!;
  assert.equal(stored.environmentId, DEFAULT_HOST_ENVIRONMENT_ID);
  assert.equal(stored.prefix, created.prefix);
  assert.notEqual(stored.keyHash, created.key);
  assert.equal(stored.createdBy, 'owner-1');
  assert.equal(stored.ownerSubjectType, 'workspace');
  assert.equal(stored.ownerSubjectId, DEFAULT_HOST_WORKSPACE_ID);

  const listed = await apiKeys.list({
    owner: { type: 'workspace', id: DEFAULT_HOST_WORKSPACE_ID },
  });
  assert.equal(listed.length, 1);
  assert.equal('key' in listed[0]!, false);

  await assert.rejects(
    apiKeys.create({
      name: 'Wrong module key',
      scope: {
        productId: DEFAULT_HOST_PRODUCT_ID,
        workspaceId: DEFAULT_HOST_WORKSPACE_ID,
        moduleId: 'other-module',
      },
      permissions: [Permission.CreditsRead],
    }),
    /MODULE_API_KEY_MODULE_SCOPE_DENIED/
  );
  await assert.rejects(
    apiKeys.create({
      name: 'Wrong environment key',
      scope: {
        productId: DEFAULT_HOST_PRODUCT_ID,
        environmentId: 'live',
        workspaceId: DEFAULT_HOST_WORKSPACE_ID,
        moduleId: contract.id,
      },
      permissions: [Permission.CreditsRead],
    }),
    /MODULE_API_KEY_ENVIRONMENT_SCOPE_DENIED/
  );
  await assert.rejects(
    apiKeys.create({
      name: 'Undeclared permission key',
      permissions: [Permission.FilesWrite],
    }),
    /MODULE_API_KEY_PERMISSION_SCOPE_DENIED/
  );
  const userApiKeys = createHostModuleApiKeysApi({
    contract,
    store,
    session: {
      ...session,
      user: { id: 'owner-1', role: 'user' },
      userId: 'owner-1',
      actorId: 'owner-1',
    } as ModuleHostSession,
  });
  await assert.rejects(
    userApiKeys.create({
      name: 'Wrong owner key',
      owner: { type: 'user', id: 'other-user' },
      scope: {
        productId: DEFAULT_HOST_PRODUCT_ID,
        workspaceId: DEFAULT_HOST_WORKSPACE_ID,
        moduleId: contract.id,
      },
      permissions: [Permission.CreditsRead],
    }),
    /MODULE_API_KEY_OWNER_SCOPE_DENIED/
  );

  const otherRecord = await store.createApiKey({
    id: 'api_key_other_module',
    productId: DEFAULT_HOST_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    moduleId: 'other-module',
    name: 'Other module key',
    prefix: 'pk_other_mod',
    keyHash: 'other_hash',
    ownerSubjectType: 'workspace',
    ownerSubjectId: DEFAULT_HOST_WORKSPACE_ID,
    permissions: [Permission.CreditsRead],
  });
  assert.equal((await apiKeys.list()).some((record) => record.id === otherRecord.id), false);
  await assert.rejects(apiKeys.rotate({ id: otherRecord.id }), /MODULE_API_KEY_SCOPE_DENIED/);

  const verified = await apiKeys.verify(created.key!);
  assert.equal(verified.ok, true);
  assert.equal(verified.apiKeyId, created.id);
  assert.equal(verified.environmentId, DEFAULT_HOST_ENVIRONMENT_ID);
  assert.deepEqual(verified.subject, { type: 'workspace', id: DEFAULT_HOST_WORKSPACE_ID });
  assert.deepEqual(verified.permissions, [Permission.CreditsRead]);
  assert.ok((await store.getApiKey({ id: created.id }))?.lastUsedAt);
  await store.updateApiKey(created.id, {
    status: 'rotating',
    rateLimit: { windowMs: 60000, limit: 120 },
  });
  assert.equal((await apiKeys.verify(created.key!)).ok, true);
  assert.equal((await apiKeys.list({ status: 'rotating' })).length, 1);
  assert.deepEqual((await store.getApiKey({ id: created.id }))?.rateLimit, {
    windowMs: 60000,
    limit: 120,
  });
  await store.updateApiKey(created.id, { status: 'active', rateLimit: null });

  const verifier = createHostModuleApiKeyVerifier({ store });
  const machine = await verifier({
    apiKey: created.key!,
    moduleId: contract.id,
    route: {} as never,
    host: {} as never,
    request: new Request('https://example.test/api'),
    params: {},
  });
  assert.equal(machine.ok, true);
  assert.equal(machine.ok ? machine.session?.authKind : undefined, 'apiKey');
  assert.deepEqual(machine.ok ? machine.session?.subject : undefined, {
    type: 'workspace',
    id: DEFAULT_HOST_WORKSPACE_ID,
  });

  const altWorkspaceId = 'workspace-alt';
  const altSession = {
    ...session,
    workspaceId: altWorkspaceId,
    user: { id: 'owner-2', role: 'admin' },
    userId: 'owner-2',
    actorId: 'owner-2',
  } as ModuleHostSession;
  const altApiKeys = createHostModuleApiKeysApi({ contract, store, session: altSession });
  const altCreated = await altApiKeys.create({
    name: 'Alt workspace route key',
    owner: { type: 'workspace', id: altWorkspaceId },
    scope: {
      productId: DEFAULT_HOST_PRODUCT_ID,
      workspaceId: altWorkspaceId,
      moduleId: contract.id,
    },
    permissions: [Permission.CreditsRead],
  });
  const altMachine = await verifier({
    apiKey: altCreated.key!,
    moduleId: contract.id,
    route: {} as never,
    host: {} as never,
    request: new Request('https://example.test/api'),
    params: {},
  });
  assert.equal(altMachine.ok, true);
  assert.equal(altMachine.ok ? altMachine.session?.workspaceId : undefined, altWorkspaceId);
  assert.deepEqual(altMachine.ok ? altMachine.session?.subject : undefined, {
    type: 'workspace',
    id: altWorkspaceId,
  });

  const altProductId = 'product-alt';
  const altProductWorkspaceId = 'workspace-product-alt';
  const altProductSession = {
    ...session,
    productId: altProductId,
    workspaceId: altProductWorkspaceId,
    user: { id: 'owner-3', role: 'admin' },
    userId: 'owner-3',
    actorId: 'owner-3',
  } as ModuleHostSession;
  const altProductApiKeys = createHostModuleApiKeysApi({
    contract,
    store,
    session: altProductSession,
  });
  const altProductCreated = await altProductApiKeys.create({
    name: 'Alt product route key',
    owner: { type: 'workspace', id: altProductWorkspaceId },
    scope: {
      productId: altProductId,
      workspaceId: altProductWorkspaceId,
      moduleId: contract.id,
    },
    permissions: [Permission.CreditsRead],
  });
  const wrongProductMachine = await verifier({
    apiKey: altProductCreated.key!,
    moduleId: contract.id,
    route: {} as never,
    host: {} as never,
    request: new Request('https://example.test/api'),
    params: {},
  });
  assert.equal(wrongProductMachine.ok, false);
  const altProductMachine = await verifier({
    apiKey: altProductCreated.key!,
    moduleId: contract.id,
    route: {} as never,
    host: {} as never,
    request: new Request('https://example.test/api'),
    params: {},
    session: { user: null, productId: altProductId },
  });
  assert.equal(altProductMachine.ok, true);
  assert.equal(altProductMachine.ok ? altProductMachine.session?.productId : undefined, altProductId);
  assert.equal(
    altProductMachine.ok ? altProductMachine.session?.workspaceId : undefined,
    altProductWorkspaceId
  );

  const liveSession = {
    ...session,
    environmentId: 'live',
    user: { id: 'owner-4', role: 'admin' },
    userId: 'owner-4',
    actorId: 'owner-4',
  } as ModuleHostSession;
  const liveApiKeys = createHostModuleApiKeysApi({ contract, store, session: liveSession });
  const liveCreated = await liveApiKeys.create({
    name: 'Live worker key',
    owner: { type: 'workspace', id: DEFAULT_HOST_WORKSPACE_ID },
    scope: {
      productId: DEFAULT_HOST_PRODUCT_ID,
      environmentId: 'live',
      workspaceId: DEFAULT_HOST_WORKSPACE_ID,
      moduleId: contract.id,
    },
    permissions: [Permission.CreditsRead],
  });
  assert.equal(
    (
      await verifier({
        apiKey: liveCreated.key!,
        moduleId: contract.id,
        route: {} as never,
        host: {} as never,
        request: new Request('https://example.test/api'),
        params: {},
        session: { user: null, productId: DEFAULT_HOST_PRODUCT_ID, environmentId: 'dev' },
      })
    ).ok,
    false
  );
  const liveMachine = await verifier({
    apiKey: liveCreated.key!,
    moduleId: contract.id,
    route: {} as never,
    host: {} as never,
    request: new Request('https://example.test/api'),
    params: {},
    session: { user: null, productId: DEFAULT_HOST_PRODUCT_ID, environmentId: 'live' },
  });
  assert.equal(liveMachine.ok, true);
  assert.equal(liveMachine.ok ? liveMachine.session?.environmentId : undefined, 'live');

  const rotated = await apiKeys.rotate({ id: created.id });
  assert.notEqual(rotated.id, created.id);
  assert.equal((await apiKeys.verify(created.key!)).ok, true);
  assert.equal((await apiKeys.verify(rotated.key)).ok, true);
  assert.equal((await apiKeys.list({ status: 'rotating' })).length, 1);

  await apiKeys.revoke({ id: created.id, reason: 'test' });
  assert.equal((await apiKeys.verify(created.key!)).ok, false);
  assert.equal((await apiKeys.verify(rotated.key)).ok, false);
  assert.equal((await apiKeys.list({ status: 'revoked' })).length, 2);
});
