import assert from 'node:assert/strict';
import test from 'node:test';
import {
  action,
  defineModule,
  Permission,
  sql,
  type CommercialSubject,
  type ModuleContext,
  type ModuleDataApi,
  type ModuleDataDocument,
} from '@ploykit/module-sdk';
import { createModuleHost } from '../src/lib/module-runtime';

test('runtime capability guard blocks undeclared permissions and cross-user credit consumption', async () => {
  const guardedModule = defineModule({
    id: 'capability-guard-test',
    name: 'Capability Guard Test',
    version: '0.1.0',
    permissions: [Permission.CreditsConsume],
    actions: {
      writeArtifact: {
        handler: './actions/write-artifact',
        auth: 'auth',
      },
      consumeOtherCredits: {
        handler: './actions/consume-other-credits',
        auth: 'auth',
      },
    },
  });
  const host = await createModuleHost({
    artifact: {
      kind: 'source',
      modules: {
        'capability-guard-test': {
          module: async () => ({ default: guardedModule }),
          actions: {
            'actions/write-artifact': async () => ({
              default: action(async (ctx: ModuleContext) => {
                await ctx.artifacts.write({
                  name: 'blocked',
                  kind: 'json',
                  path: 'blocked.json',
                  content: {},
                });
              }),
            }),
            'actions/consume-other-credits': async () => ({
              default: action(async (ctx: ModuleContext) =>
                ctx.credits.consume({
                  userId: 'other-user',
                  amount: 1,
                })
              ),
            }),
          },
        },
      },
    },
    capabilities: {
      artifacts: {
        async write() {
          throw new Error('ARTIFACT_SHOULD_NOT_WRITE');
        },
        async writeText() {
          throw new Error('ARTIFACT_SHOULD_NOT_WRITE');
        },
        async read() {
          return null;
        },
        async readText() {
          return null;
        },
        async updateMetadata() {
          throw new Error('ARTIFACT_SHOULD_NOT_WRITE');
        },
        async list() {
          return [];
        },
        async tree() {
          return [];
        },
        async delete() {
          throw new Error('ARTIFACT_SHOULD_NOT_WRITE');
        },
      },
      credits: {
        async balance(input: string | { subject: CommercialSubject; unit?: string }) {
          const subject =
            typeof input === 'string' ? { type: 'user' as const, id: input } : input.subject;
          return {
            subject,
            userId: subject.type === 'user' ? subject.id : undefined,
            unit: typeof input === 'string' ? 'credit' : (input.unit ?? 'credit'),
            balance: 10,
          };
        },
        async grant(input) {
          return { userId: input.userId, unit: input.unit ?? 'credit', balance: input.amount };
        },
        async consume(input) {
          return { userId: input.userId, unit: input.unit ?? 'credit', balance: 9 };
        },
        async adjust(input) {
          return { userId: input.userId, unit: input.unit ?? 'credit', balance: input.amount };
        },
        async refund(input) {
          return { userId: input.userId, unit: input.unit ?? 'credit', balance: input.amount };
        },
        async reserve(input) {
          return {
            id: 'test-reservation',
            subject: input.subject ?? { type: 'user', id: input.userId ?? 'test-user' },
            amountReserved: input.amount,
            amountCommitted: 0,
            unit: input.unit ?? 'credit',
            status: 'reserved',
            metadata: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        },
        async commitReservation() {
          return { userId: 'test-user', unit: 'credit', balance: 9 };
        },
        async releaseReservation() {
          return { userId: 'test-user', unit: 'credit', balance: 10 };
        },
        async revokeBySource() {
          return { revoked: 0 };
        },
        async refundRevoke(input) {
          const subject = input.subject ?? { type: 'user' as const, id: input.userId ?? 'test-user' };
          return {
            revoked: 0,
            unrecovered: input.amount ?? 0,
            balance: {
              subject,
              userId: subject.type === 'user' ? subject.id : undefined,
              unit: input.unit ?? 'credit',
              balance: 10,
            },
            relatedLedgerIds: [],
          };
        },
        async listLedger() {
          return [];
        },
      },
    },
  });

  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'capability-guard-test',
        name: 'writeArtifact',
        session: {
          user: { id: 'user_9', role: 'user' },
        },
      }),
    /MODULE_CAPABILITY_PERMISSION_NOT_DECLARED/
  );
  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'capability-guard-test',
        name: 'consumeOtherCredits',
        session: {
          user: { id: 'user_9', role: 'user' },
          permissions: [Permission.CreditsConsume],
          userId: 'user_9',
        },
      }),
    /MODULE_CAPABILITY_SUBJECT_SCOPE_DENIED/
  );
});

test('runtime capability guard applies inside data transactions', async () => {
  let wrote = false;
  const transactionGuardModule = defineModule({
    id: 'transaction-guard-test',
    name: 'Transaction Guard Test',
    version: '0.1.0',
    permissions: [Permission.DataTransaction],
    actions: {
      transact: {
        handler: './actions/transact',
        auth: 'auth',
      },
    },
  });
  const unused = async () => {
    throw new Error('DATA_STUB_UNUSED');
  };
  let data: ModuleDataApi;
  data = {
    document<TRecord = Record<string, unknown>>(): ModuleDataDocument<TRecord> {
      return {
        findMany: unused,
        findOne: unused,
        findById: unused,
        async insert(input) {
          wrote = true;
          return { id: 'doc-1', ...input } as TRecord;
        },
        insertMany: unused,
        insertIfAbsent: unused,
        upsert: unused,
        update: unused,
        updateWhere: unused,
        delete: unused,
        claim: unused,
        count: unused,
        exists: unused,
      };
    },
    table() {
      throw new Error('DATA_TABLE_UNUSED');
    },
    async transaction<T>(callback: (tx: ModuleDataApi) => Promise<T>): Promise<T> {
      return callback(data);
    },
    tableRef() {
      return { text: 'unused', values: [] };
    },
    viewRef() {
      return { text: 'unused', values: [] };
    },
    sql: {
      query: unused,
      execute: unused,
    },
  } satisfies ModuleDataApi;
  const host = await createModuleHost({
    artifact: {
      kind: 'source',
      modules: {
        'transaction-guard-test': {
          module: async () => ({ default: transactionGuardModule }),
          actions: {
            'actions/transact': async () => ({
              default: action(async (ctx: ModuleContext) =>
                ctx.data.transaction((tx) => tx.document('items').insert({ title: 'blocked' }))
              ),
            }),
          },
        },
      },
    },
    createDataApi: () => data,
  });

  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'transaction-guard-test',
        name: 'transact',
        session: {
          user: { id: 'user_10', role: 'user' },
          permissions: [Permission.DataTransaction],
        },
      }),
    /MODULE_CAPABILITY_PERMISSION_NOT_DECLARED/
  );
  assert.equal(wrote, false);
});

test('runtime capability guard requires UnsafeSqlRaw for ctx.data.sql execution', async () => {
  let queried = false;
  let executed = false;
  const sqlGuardModule = defineModule({
    id: 'sql-raw-guard-test',
    name: 'SQL Raw Guard Test',
    version: '0.1.0',
    permissions: [Permission.DataSqlRead, Permission.DataSqlWrite, Permission.UnsafeSqlRaw],
    actions: {
      queryRaw: {
        handler: './actions/query-raw',
        auth: 'auth',
      },
      executeRaw: {
        handler: './actions/execute-raw',
        auth: 'auth',
      },
    },
  });
  const data = {
    document() {
      throw new Error('DATA_DOCUMENT_UNUSED');
    },
    table() {
      throw new Error('DATA_TABLE_UNUSED');
    },
    async transaction<T>(callback: (tx: ModuleDataApi) => Promise<T>): Promise<T> {
      return callback(this);
    },
    tableRef() {
      return { text: 'unused', values: [] };
    },
    viewRef() {
      return { text: 'unused', values: [] };
    },
    sql: {
      async query() {
        queried = true;
        return [];
      },
      async execute() {
        executed = true;
        return { rowCount: 1 };
      },
    },
  } satisfies ModuleDataApi;
  const host = await createModuleHost({
    artifact: {
      kind: 'source',
      modules: {
        'sql-raw-guard-test': {
          module: async () => ({ default: sqlGuardModule }),
          actions: {
            'actions/query-raw': async () => ({
              default: action(async (ctx: ModuleContext) => ctx.data.sql.query(sql`select 1`)),
            }),
            'actions/execute-raw': async () => ({
              default: action(async (ctx: ModuleContext) =>
                ctx.data.sql.execute(sql`delete from items`)
              ),
            }),
          },
        },
      },
    },
    createDataApi: () => data,
  });

  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'sql-raw-guard-test',
        name: 'queryRaw',
        session: {
          user: { id: 'user_11', role: 'user' },
          permissions: [Permission.DataSqlRead],
        },
      }),
    /MODULE_CAPABILITY_SYSTEM_PERMISSION_REQUIRED/
  );
  assert.equal(queried, false);

  await host.executeAction({
    moduleId: 'sql-raw-guard-test',
    name: 'queryRaw',
    session: {
      user: null,
      system: true,
      permissions: [Permission.DataSqlRead, Permission.UnsafeSqlRaw],
    },
  });
  assert.equal(queried, true);

  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'sql-raw-guard-test',
        name: 'executeRaw',
        session: {
          user: { id: 'user_11', role: 'user' },
          permissions: [Permission.DataSqlWrite],
        },
      }),
    /MODULE_CAPABILITY_SYSTEM_PERMISSION_REQUIRED/
  );
  assert.equal(executed, false);

  await host.executeAction({
    moduleId: 'sql-raw-guard-test',
    name: 'executeRaw',
    session: {
      user: null,
      system: true,
      permissions: [Permission.DataSqlWrite, Permission.UnsafeSqlRaw],
    },
  });
  assert.equal(executed, true);
});

test('runtime capability guard protects subject-scoped entitlements, redeem codes, and risk', async () => {
  const guardedModule = defineModule({
    id: 'subject-commercial-guard-test',
    name: 'Subject Commercial Guard Test',
    version: '0.1.0',
    permissions: [
      Permission.EntitlementsRead,
      Permission.EntitlementsWrite,
      Permission.CreditsConsume,
      Permission.CreditsWrite,
      Permission.RedeemCodesRedeem,
      Permission.RiskRead,
    ],
    actions: {
      ownEntitlement: {
        handler: './actions/own-entitlement',
        auth: 'auth',
      },
      otherRedeem: {
        handler: './actions/other-redeem',
        auth: 'auth',
      },
      otherRisk: {
        handler: './actions/other-risk',
        auth: 'auth',
      },
      revokeOtherEntitlement: {
        handler: './actions/revoke-other-entitlement',
        auth: 'auth',
      },
      expireEntitlements: {
        handler: './actions/expire-entitlements',
        auth: 'auth',
      },
      commitOtherReservation: {
        handler: './actions/commit-other-reservation',
        auth: 'auth',
      },
      revokeOtherCreditSource: {
        handler: './actions/revoke-other-credit-source',
        auth: 'auth',
      },
    },
  });
  const host = await createModuleHost({
    artifact: {
      kind: 'source',
      modules: {
        'subject-commercial-guard-test': {
          module: async () => ({ default: guardedModule }),
          actions: {
            'actions/own-entitlement': async () => ({
              default: action(async (ctx: ModuleContext) =>
                ctx.entitlements.has({
                  subject: { type: 'user', id: 'user_subject_1' },
                  entitlement: 'pro',
                })
              ),
            }),
            'actions/other-redeem': async () => ({
              default: action(async (ctx: ModuleContext) =>
                ctx.redeemCodes.redeem({
                  code: 'CODE',
                  subject: { type: 'user', id: 'other-user' },
                })
              ),
            }),
            'actions/other-risk': async () => ({
              default: action(async (ctx: ModuleContext) =>
                ctx.risk.check({ subject: { type: 'workspace', id: 'other-workspace' } })
              ),
            }),
            'actions/revoke-other-entitlement': async () => ({
              default: action(async (ctx: ModuleContext) =>
                ctx.entitlements.revoke({ id: 'entitlement_other' })
              ),
            }),
            'actions/expire-entitlements': async () => ({
              default: action(async (ctx: ModuleContext) => ctx.entitlements.expire()),
            }),
            'actions/commit-other-reservation': async () => ({
              default: action(async (ctx: ModuleContext) =>
                ctx.credits.commitReservation({ reservationId: 'reservation_other' })
              ),
            }),
            'actions/revoke-other-credit-source': async () => ({
              default: action(async (ctx: ModuleContext) =>
                ctx.credits.revokeBySource({ source: 'order', sourceId: 'order_other' })
              ),
            }),
          },
        },
      },
    },
    capabilities: {
      entitlements: {
        async has() {
          return true;
        },
        async list() {
          return [
            {
              id: 'entitlement_other',
              subject: { type: 'user', id: 'other-user' },
              userId: 'other-user',
              entitlement: 'pro',
              source: 'test',
              status: 'active',
              metadata: {},
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ];
        },
        async grant() {
          throw new Error('ENTITLEMENT_WRITE_UNUSED');
        },
        async revoke() {
          throw new Error('ENTITLEMENT_WRITE_UNUSED');
        },
        async override() {
          throw new Error('ENTITLEMENT_WRITE_UNUSED');
        },
        async expire() {
          return { expired: 0 };
        },
      },
      credits: {
        async balance() {
          return {
            subject: { type: 'user', id: 'other-user' },
            userId: 'other-user',
            unit: 'credit',
            balance: 0,
          };
        },
        async grant() {
          throw new Error('CREDIT_WRITE_UNUSED');
        },
        async consume() {
          throw new Error('CREDIT_CONSUME_UNUSED');
        },
        async adjust() {
          throw new Error('CREDIT_WRITE_UNUSED');
        },
        async refund() {
          throw new Error('CREDIT_WRITE_UNUSED');
        },
        async reserve() {
          throw new Error('CREDIT_CONSUME_UNUSED');
        },
        async commitReservation() {
          throw new Error('CREDIT_COMMIT_SHOULD_NOT_RUN');
        },
        async releaseReservation() {
          throw new Error('CREDIT_RELEASE_SHOULD_NOT_RUN');
        },
        async revokeBySource() {
          throw new Error('CREDIT_REVOKE_SHOULD_NOT_RUN');
        },
        async refundRevoke() {
          throw new Error('CREDIT_REFUND_REVOKE_SHOULD_NOT_RUN');
        },
        async listLedger() {
          return [
            {
              id: 'credit_other',
              subject: { type: 'user', id: 'other-user' },
              amount: -1,
              unit: 'credit',
              direction: 'reserve',
              status: 'reserved',
              reason: 'reserve',
              source: 'order',
              sourceId: 'order_other',
              reservationId: 'reservation_other',
              metadata: {},
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ];
        },
      },
      redeemCodes: {
        async createBatch() {
          throw new Error('REDEEM_WRITE_UNUSED');
        },
        async redeem() {
          return { ok: true };
        },
        async freeze() {
          return { frozen: 0 };
        },
        async revoke() {
          throw new Error('REDEEM_WRITE_UNUSED');
        },
        async list() {
          return [];
        },
        async listRedemptions() {
          return [];
        },
      },
      risk: {
        async record() {
          throw new Error('RISK_WRITE_UNUSED');
        },
        async block() {
          return { blocked: true };
        },
        async check() {
          return { ok: true };
        },
      },
    },
  });

  await assert.equal(
    await host.executeAction({
      moduleId: 'subject-commercial-guard-test',
      name: 'ownEntitlement',
      session: {
        user: { id: 'user_subject_1', role: 'user' },
        userId: 'user_subject_1',
        permissions: [Permission.EntitlementsRead],
      },
    }),
    true
  );
  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'subject-commercial-guard-test',
        name: 'otherRedeem',
        session: {
          user: { id: 'user_subject_1', role: 'user' },
          userId: 'user_subject_1',
          permissions: [Permission.RedeemCodesRedeem],
        },
      }),
    /MODULE_CAPABILITY_SUBJECT_SCOPE_DENIED/
  );
  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'subject-commercial-guard-test',
        name: 'revokeOtherEntitlement',
        session: {
          user: { id: 'user_subject_1', role: 'user' },
          userId: 'user_subject_1',
          permissions: [Permission.EntitlementsWrite],
        },
      }),
    /MODULE_CAPABILITY_SUBJECT_SCOPE_DENIED/
  );
  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'subject-commercial-guard-test',
        name: 'expireEntitlements',
        session: {
          user: { id: 'user_subject_1', role: 'user' },
          userId: 'user_subject_1',
          permissions: [Permission.EntitlementsWrite],
        },
      }),
    /MODULE_CAPABILITY_BULK_COMMERCIAL_WRITE_DENIED/
  );
  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'subject-commercial-guard-test',
        name: 'commitOtherReservation',
        session: {
          user: { id: 'user_subject_1', role: 'user' },
          userId: 'user_subject_1',
          permissions: [Permission.CreditsConsume],
        },
      }),
    /MODULE_CAPABILITY_SUBJECT_SCOPE_DENIED/
  );
  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'subject-commercial-guard-test',
        name: 'revokeOtherCreditSource',
        session: {
          user: { id: 'user_subject_1', role: 'user' },
          userId: 'user_subject_1',
          permissions: [Permission.CreditsWrite],
        },
      }),
    /MODULE_CAPABILITY_SUBJECT_SCOPE_DENIED/
  );
  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'subject-commercial-guard-test',
        name: 'otherRisk',
        session: {
          user: { id: 'user_subject_1', role: 'user' },
          userId: 'user_subject_1',
          workspaceId: 'workspace_subject_1',
          permissions: [Permission.RiskRead],
        },
      }),
    /MODULE_CAPABILITY_SUBJECT_SCOPE_DENIED/
  );
});
