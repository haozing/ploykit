import assert from 'node:assert/strict';
import test from 'node:test';
import {
  action,
  createTestingModuleContext,
  defineModule,
  Permission,
  type ModuleContext,
} from '@ploykit/module-sdk';
import {
  createModuleHost,
  createRuntimeStoreModuleResourceBindingsApi,
  createInMemoryRuntimeStore,
  guardModuleContextCapabilities,
  normalizeModuleRuntimeContract,
} from '../src/lib/module-runtime';

test('runtime capability guard restricts connectors to declared services', async () => {
  const connectorModule = defineModule({
    id: 'connector-guard-test',
    name: 'Connector Guard Test',
    version: '0.1.0',
    permissions: [Permission.ConnectorsRead, Permission.ConnectorsInvoke],
    serviceRequirements: {
      github: {
        provider: 'http',
      },
    },
  });
  const context = createTestingModuleContext({ moduleId: connectorModule.id });
  const guarded = guardModuleContextCapabilities({
    context,
    contract: normalizeModuleRuntimeContract(connectorModule),
    session: {
      user: { id: 'user_connector', role: 'user' },
      permissions: [Permission.ConnectorsRead, Permission.ConnectorsInvoke],
    },
  });

  await assert.rejects(
    () => guarded.connectors.get('stripe'),
    /MODULE_CAPABILITY_SERVICE_NOT_DECLARED/
  );
  await assert.rejects(
    () => guarded.connectors.invoke('stripe', 'fetch', {}),
    /MODULE_CAPABILITY_SERVICE_NOT_DECLARED/
  );
  assert.equal(await guarded.connectors.get('github'), null);
});

test('runtime capability guard scopes resource binding writes to declared workspace bindings', async () => {
  const bindingModule = defineModule({
    id: 'resource-binding-write-test',
    name: 'Resource Binding Write Test',
    version: '0.1.0',
    permissions: [Permission.ResourceBindingsRead, Permission.ResourceBindingsWrite],
    resourceBindings: {
      workspaceConfig: {
        kind: 'demo.workspace',
        required: false,
      },
    },
  });
  const contract = normalizeModuleRuntimeContract(bindingModule);
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-29T00:00:00.000Z'),
  });
  const resourceBindings = createRuntimeStoreModuleResourceBindingsApi({
    store,
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: contract.id,
    actorId: 'actor-a',
  });
  const context = {
    ...createTestingModuleContext({ moduleId: contract.id }),
    resourceBindings,
  };

  const ownerGuarded = guardModuleContextCapabilities({
    context,
    contract,
    session: {
      user: { id: 'user_binding_owner', role: 'user' },
      permissions: [Permission.ResourceBindingsRead],
      productId: 'product-a',
      workspaceId: 'workspace-a',
      workspaceRole: 'owner',
      actorId: 'actor-a',
    },
  });
  const ownerUpsert = ownerGuarded.resourceBindings.upsert;
  assert.ok(ownerUpsert);

  const value = await ownerUpsert(
    'workspaceConfig',
    { remoteAccountId: 'acct_123' },
    { kind: 'demo.workspace', metadata: { source: 'test' } }
  );

  assert.deepEqual(value, { remoteAccountId: 'acct_123' });
  assert.deepEqual(await ownerGuarded.resourceBindings.get('workspaceConfig'), {
    remoteAccountId: 'acct_123',
  });

  const records = await store.listResourceBindings({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: contract.id,
  });
  assert.equal(records.length, 1);
  assert.equal(records[0]?.name, 'workspaceConfig');
  assert.equal(records[0]?.updatedBy, 'actor-a');
  assert.deepEqual(records[0]?.value, { remoteAccountId: 'acct_123' });

  const audit = await store.listAudit({
    productId: 'product-a',
    type: 'host.resource_binding.upserted',
  });
  assert.equal(audit.length, 1);
  assert.equal(audit[0]?.workspaceId, 'workspace-a');
  assert.equal(audit[0]?.moduleId, contract.id);
  assert.equal(audit[0]?.metadata.name, 'workspaceConfig');

  await assert.rejects(
    () => ownerUpsert('otherConfig', { remoteAccountId: 'acct_456' }),
    /MODULE_CAPABILITY_RESOURCE_BINDING_NOT_DECLARED/
  );
  await assert.rejects(
    () => ownerUpsert('workspaceConfig', { token: 'plain-secret' }),
    /MODULE_RESOURCE_BINDING_SECRET_VALUE_DENIED/
  );

  const viewerGuarded = guardModuleContextCapabilities({
    context,
    contract,
    session: {
      user: { id: 'user_binding_viewer', role: 'user' },
      permissions: [Permission.ResourceBindingsRead],
      productId: 'product-a',
      workspaceId: 'workspace-a',
      workspaceRole: 'viewer',
      actorId: 'actor-b',
    },
  });
  const viewerUpsert = viewerGuarded.resourceBindings.upsert;
  assert.ok(viewerUpsert);

  await assert.rejects(
    () => viewerUpsert('workspaceConfig', { remoteAccountId: 'acct_789' }),
    /MODULE_CAPABILITY_PERMISSION_DENIED/
  );
});

test('runtime capability guard denies declared capability when session permissions are absent', async () => {
  const guardModule = defineModule({
    id: 'session-permission-test',
    name: 'Session Permission Test',
    version: '0.1.0',
    permissions: [Permission.AuditWrite],
    actions: {
      recordAudit: {
        handler: './actions/record-audit',
        auth: 'auth',
      },
    },
  });
  const host = await createModuleHost({
    artifact: {
      kind: 'source',
      modules: {
        'session-permission-test': {
          module: async () => ({ default: guardModule }),
          actions: {
            'actions/record-audit': async () => ({
              default: action(async (ctx: ModuleContext) => {
                await ctx.audit.record('session.permission.test', {});
              }),
            }),
          },
        },
      },
    },
    capabilities: {
      audit: {
        async record() {
          throw new Error('AUDIT_SHOULD_NOT_RECORD');
        },
      },
    },
  });

  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'session-permission-test',
        name: 'recordAudit',
        session: {
          user: { id: 'user_8b', role: 'user' },
        },
      }),
    /MODULE_CAPABILITY_PERMISSION_DENIED/
  );
});

test('runtime capability guard fails closed when audit provider is not mounted', async () => {
  const auditModule = defineModule({
    id: 'audit-unmounted-test',
    name: 'Audit Unmounted Test',
    version: '0.1.0',
    permissions: [Permission.AuditWrite],
    actions: {
      recordAudit: {
        handler: './actions/record-audit',
        auth: 'auth',
      },
    },
  });
  const host = await createModuleHost({
    artifact: {
      kind: 'source',
      modules: {
        'audit-unmounted-test': {
          module: async () => ({ default: auditModule }),
          actions: {
            'actions/record-audit': async () => ({
              default: action(async (ctx: ModuleContext) => {
                await ctx.audit.record('audit.unmounted.test', {});
                return { ok: true };
              }),
            }),
          },
        },
      },
    },
  });

  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'audit-unmounted-test',
        name: 'recordAudit',
        session: {
          user: { id: 'user_8c', role: 'user' },
          permissions: [Permission.AuditWrite],
        },
      }),
    /MODULE_CAPABILITY_UNAVAILABLE: ctx\.audit\.record is not mounted/
  );
});

test('runtime capability guard allows structured audit records with AuditWrite', async () => {
  const records: unknown[] = [];
  const auditModule = defineModule({
    id: 'structured-audit-test',
    name: 'Structured Audit Test',
    version: '0.1.0',
    permissions: [Permission.AuditWrite],
    actions: {
      recordAudit: {
        handler: './actions/record-audit',
        auth: 'auth',
      },
    },
  });
  const host = await createModuleHost({
    artifact: {
      kind: 'source',
      modules: {
        'structured-audit-test': {
          module: async () => ({ default: auditModule }),
          actions: {
            'actions/record-audit': async () => ({
              default: action(async (ctx: ModuleContext) => {
                await ctx.audit.record({
                  actorKind: 'hosted_user',
                  actorId: 'user_8d',
                  action: 'session.permission.structured',
                  category: 'security',
                  targetKind: 'session',
                  targetId: 'session_1',
                  decision: 'allow',
                  requestId: 'req_1',
                  metadata: { email: 'User@Example.com' },
                });
                return { ok: true };
              }),
            }),
          },
        },
      },
    },
    capabilities: {
      audit: {
        async record(input, metadata) {
          records.push(typeof input === 'string' ? { type: input, metadata } : input);
        },
      },
    },
  });

  await host.executeAction({
    moduleId: 'structured-audit-test',
    name: 'recordAudit',
    session: {
      user: { id: 'user_8d', role: 'user' },
      permissions: [Permission.AuditWrite],
    },
  });

  assert.equal((records[0] as { action?: string }).action, 'session.permission.structured');
});

test('runtime capability guard protects notification reads separately from sends', async () => {
  const notificationModule = defineModule({
    id: 'notification-read-test',
    name: 'Notification Read Test',
    version: '0.1.0',
    permissions: [Permission.NotificationsSend],
    actions: {
      listNotifications: {
        handler: './actions/list-notifications',
        auth: 'auth',
      },
    },
  });
  const host = await createModuleHost({
    artifact: {
      kind: 'source',
      modules: {
        'notification-read-test': {
          module: async () => ({ default: notificationModule }),
          actions: {
            'actions/list-notifications': async () => ({
              default: action(async (ctx: ModuleContext) => ctx.notifications.list()),
            }),
          },
        },
      },
    },
    capabilities: {
      notifications: {
        async send(input) {
          return {
            id: 'notification-1',
            moduleId: 'notification-read-test',
            userId: input.userId,
            channel: input.channel ?? 'inApp',
            title: input.title,
            status: 'unread',
            metadata: {},
            createdAt: '2026-01-01T00:00:00.000Z',
          };
        },
        async list() {
          throw new Error('NOTIFICATIONS_SHOULD_NOT_LIST');
        },
        async markRead() {
          throw new Error('NOTIFICATIONS_SHOULD_NOT_MARK_READ');
        },
      },
    },
  });

  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'notification-read-test',
        name: 'listNotifications',
        session: {
          user: { id: 'user_8c', role: 'user' },
          permissions: [Permission.NotificationsRead],
        },
      }),
    /MODULE_CAPABILITY_PERMISSION_NOT_DECLARED/
  );
});
