import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Pool, type QueryResultRow } from 'pg';
import { normalizeModuleRuntimeContract } from '../src/lib/module-runtime/contract/normalize-contract';
import {
  createMemoryModuleDataApi,
  createMemoryModuleDataStore,
  createPgModuleDataExecutor,
  createPostgresModuleDataApi,
  createPostgresModuleDataHostFactory,
  type ModuleDataRuntimeSession,
} from '../src/lib/module-runtime/data';

const PROJECT_ROOT = process.cwd();
const OWNER_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://ploykit:ploykit@127.0.0.1:55432/ploykit';
const APP_DATABASE_URL =
  process.env.PLOYKIT_APP_DATABASE_URL ??
  'postgres://ploykit_app:ploykit_app@127.0.0.1:55432/ploykit';
const APP_ROLE = 'ploykit_app';
const APP_PASSWORD = 'ploykit_app';

interface HelloMessage {
  id: string;
  message: string;
}

interface HelloPost {
  id: string;
  title: string;
  status: string;
  metadata: unknown;
  deleted_at: Date | string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function modulePhysicalTableName(moduleId: string, tableName: string): string {
  return `mod_${moduleId.replace(/-/g, '_')}__${tableName}`;
}

function normalizePolicyExpression(expression: string): string {
  let value = expression.replace(/\s+/g, '').replace(/::text/g, '').toLowerCase();
  while (value.startsWith('(') && value.endsWith(')')) {
    let depth = 0;
    let wrapped = true;
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
        if (depth === 0 && index < value.length - 1) {
          wrapped = false;
          break;
        }
      }
      if (depth < 0) {
        wrapped = false;
        break;
      }
    }
    if (!wrapped || depth !== 0) {
      break;
    }
    value = value.slice(1, -1);
  }
  return value;
}

function assertPolicyExpressionIncludes(
  expression: string,
  fragments: readonly string[]
): void {
  const normalized = normalizePolicyExpression(expression);
  for (const fragment of fragments) {
    assert.ok(
      normalized.includes(normalizePolicyExpression(fragment)),
      `missing policy fragment: ${fragment}`
    );
  }
}

async function readModuleContract(moduleId: string) {
  const moduleDefinition = (await import(`../modules/${moduleId}/module.ts`)) as {
    default: {
      name: string;
      version: string;
    };
  };
  const plan = JSON.parse(
    fs.readFileSync(
      path.join(PROJECT_ROOT, `modules/${moduleId}/.ploykit/generated/data-plan.json`),
      'utf8'
    )
  );

  return normalizeModuleRuntimeContract({
    id: plan.moduleId,
    name: moduleDefinition.default.name,
    version: moduleDefinition.default.version,
    data: {
      version: plan.dataVersion,
      documents: Object.fromEntries(
        plan.documents.map((document: any) => [
          document.name,
          {
            scope: document.scope,
            fields: document.fields,
          },
        ])
      ),
      tables: Object.fromEntries(
        plan.tables.map((table: any) => [
          table.name,
          {
            $$type: 'ploykit.data.table',
            scope: table.scope,
            columns: table.columns,
            unique: table.unique,
            indexes: table.indexes,
          },
        ])
      ),
      migrations: plan.migrations,
    },
  });
}

async function waitForDatabase(url: string): Promise<void> {
  let lastError: unknown;
  for (let index = 0; index < 60; index += 1) {
    const pool = new Pool({ connectionString: url });
    try {
      await pool.query('select 1');
      await pool.end();
      return;
    } catch (error) {
      lastError = error;
      await pool.end().catch(() => undefined);
      await sleep(1000);
    }
  }

  throw new Error(
    `Postgres is not reachable at ${url}. Start it with npm run db:up. Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

async function resetDatabase(ownerPool: Pool): Promise<void> {
  await ownerPool.query(
    `select pg_terminate_backend(pid)
     from pg_stat_activity
     where usename = $1 and pid <> pg_backend_pid()`,
    [APP_ROLE]
  );
  const roleExists = await ownerPool.query<{ exists: boolean }>(
    `select exists(select 1 from pg_roles where rolname = $1)`,
    [APP_ROLE]
  );
  if (roleExists.rows[0]?.exists) {
    await ownerPool.query(`drop owned by ${APP_ROLE}`);
    await ownerPool.query(`drop role ${APP_ROLE}`);
  }
  for (const tableName of [
    modulePhysicalTableName('hello', 'hello_posts'),
    modulePhysicalTableName('capability-demo', 'demo_notes'),
    modulePhysicalTableName('shop-demo', 'products'),
    modulePhysicalTableName('shop-demo', 'coupons'),
    modulePhysicalTableName('shop-demo', 'orders'),
  ]) {
    await ownerPool.query(`drop table if exists public."${tableName}" cascade`);
  }
  await ownerPool.query('drop table if exists public.module_documents cascade');
  await ownerPool.query('drop table if exists public.module_data_models cascade');
}

async function applyMigration(ownerPool: Pool, moduleId: string): Promise<void> {
  const migration = fs.readFileSync(
    path.join(PROJECT_ROOT, `modules/${moduleId}/migrations/0001_generated.sql`),
    'utf8'
  );
  await ownerPool.query(migration);
}

async function createAppRole(ownerPool: Pool): Promise<void> {
  await ownerPool.query(
    `create role ${APP_ROLE} login password '${APP_PASSWORD}' nosuperuser nocreatedb nocreaterole noinherit`
  );
  await ownerPool.query(`grant usage on schema public to ${APP_ROLE}`);
  await ownerPool.query(
    `grant select, insert, update, delete on all tables in schema public to ${APP_ROLE}`
  );
}

function helloSession(overrides: Partial<ModuleDataRuntimeSession> = {}): ModuleDataRuntimeSession {
  return {
    productId: 'product_a',
    workspaceId: 'workspace_a',
    userId: 'user_a',
    actorId: 'user_a',
    allowPublicWrite: false,
    ...overrides,
  };
}

test('Data v2 Postgres runtime refuses unsafe RLS context options by default', async () => {
  const contract = await readModuleContract('hello');
  const database = {
    async query() {
      return { rows: [], rowCount: 0 };
    },
  };

  assert.throws(
    () =>
      createPostgresModuleDataApi({
        contract,
        database,
        session: helloSession(),
        useRlsSession: false,
      }),
    /MODULE_DATA_RLS_SESSION_DISABLED/
  );

  assert.throws(
    () =>
      createPostgresModuleDataApi({
        contract,
        database,
        session: helloSession(),
        wrapOperationsInTransaction: false,
      }),
    /MODULE_DATA_RLS_TRANSACTION_REQUIRED/
  );

  assert.doesNotThrow(() =>
    createPostgresModuleDataApi({
      contract,
      database,
      session: helloSession(),
      useRlsSession: false,
      wrapOperationsInTransaction: false,
      unsafeAllowRlsBypass: true,
    })
  );
});

test('Data v2 memory runtime supports table upsert without a Postgres store', async () => {
  const contract = await readModuleContract('capability-demo');
  const store = createMemoryModuleDataStore();
  const workspaceA = createMemoryModuleDataApi({
    contract,
    store,
    session: {
      productId: 'product_a',
      workspaceId: 'workspace_a',
      scopeId: 'workspace_a',
      userId: 'user_a',
      actorId: 'user_a',
    },
  });
  const workspaceB = createMemoryModuleDataApi({
    contract,
    store,
    session: {
      productId: 'product_a',
      workspaceId: 'workspace_b',
      scopeId: 'workspace_b',
      userId: 'user_b',
      actorId: 'user_b',
    },
  });

  const first = await workspaceA.table('demo_notes').upsert(
    {
      title: 'memory-runtime-post',
      body: 'first body',
    },
    { uniqueBy: ['title'] }
  );
  const second = await workspaceA.table('demo_notes').upsert(
    {
      title: 'memory-runtime-post',
      body: 'updated body',
    },
    { uniqueBy: ['title'] }
  );

  assert.equal(first.title, 'memory-runtime-post');
  assert.equal(second.id, first.id);
  assert.equal(second.body, 'updated body');
  assert.equal(
    (await workspaceA.table('demo_notes').findOne({ where: { title: 'memory-runtime-post' } }))
      ?.body,
    'updated body'
  );
  assert.equal(
    await workspaceB.table('demo_notes').findOne({ where: { title: 'memory-runtime-post' } }),
    null
  );
});

async function queryAsSession<TRecord extends QueryResultRow = Record<string, unknown>>(
  pool: Pool,
  session: ModuleDataRuntimeSession,
  sql: string,
  values: readonly unknown[] = []
): Promise<TRecord[]> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const settings: readonly (readonly [string, string])[] = [
      ['ploykit.module_id', 'hello'],
      ['ploykit.product_id', session.productId],
      ['ploykit.scope_type', 'user'],
      ['ploykit.scope_id', session.userId ?? ''],
      ['ploykit.user_id', session.userId ?? ''],
      ['ploykit.allow_public_write', session.allowPublicWrite ? 'true' : 'false'],
    ];
    for (const [key, value] of settings) {
      await client.query('select set_config($1, $2, true)', [key, value]);
    }
    const result = await client.query<TRecord>(sql, [...values]);
    await client.query('rollback');
    return result.rows;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

test('Data v2 Postgres runtime supports real CRUD, RLS and rollback', async () => {
  await waitForDatabase(OWNER_DATABASE_URL);

  const ownerPool = new Pool({ connectionString: OWNER_DATABASE_URL });
  await resetDatabase(ownerPool);
  await applyMigration(ownerPool, 'hello');
  await applyMigration(ownerPool, 'capability-demo');
  await applyMigration(ownerPool, 'shop-demo');
  await createAppRole(ownerPool);

  const appPool = new Pool({ connectionString: APP_DATABASE_URL });
  const database = createPgModuleDataExecutor(appPool);
  const contract = await readModuleContract('hello');
  const workspaceContract = await readModuleContract('capability-demo');
  const productContract = await readModuleContract('shop-demo');
  const userA = helloSession();
  const userB = helloSession({ userId: 'user_b', actorId: 'user_b' });
  const writer = helloSession({ allowPublicWrite: true });
  const userAData = createPostgresModuleDataApi({ contract, database, session: userA });
  const userBData = createPostgresModuleDataApi({ contract, database, session: userB });
  const writerData = createPostgresModuleDataApi({ contract, database, session: writer });

  const messagesA = userAData.document<HelloMessage>('hello_messages');
  const insertedMessage = await messagesA.insert({ message: 'alpha' });
  assert.equal((await messagesA.findById(insertedMessage.id))?.message, 'alpha');
  assert.equal(
    await userBData.document<HelloMessage>('hello_messages').findById(insertedMessage.id),
    null
  );

  const updatedMessage = await messagesA.update(insertedMessage.id, { message: 'beta' });
  assert.equal(updatedMessage.message, 'beta');
  assert.equal(await messagesA.exists({ where: { message: 'beta' } }), true);
  assert.equal(await messagesA.count(), 1);

  const claimedMessage = await messagesA.claim(
    { where: { message: 'beta' } },
    { message: 'claimed' }
  );
  assert.equal(claimedMessage?.message, 'claimed');
  await messagesA.insertIfAbsent({ message: 'once' }, { uniqueBy: ['message'] });
  await messagesA.insertIfAbsent({ message: 'once' }, { uniqueBy: ['message'] });
  assert.equal(await messagesA.count({ where: { message: 'once' } }), 1);

  await assert.rejects(
    writerData.table<HelloPost>('hello_posts').insert({ title: 'blocked', extra: true } as any),
    /MODULE_DATA_TABLE_FIELD_NOT_DECLARED/
  );

  const posts = writerData.table<HelloPost>('hello_posts');
  const firstPost = await posts.insert({
    title: 'hello-title',
    status: 'draft',
    metadata: { featured: false },
  });
  assert.equal(firstPost.status, 'draft');
  assert.equal(await posts.count({ where: { status: 'draft' } }), 1);

  const upsertedPost = await posts.upsert(
    {
      title: 'hello-title',
      status: 'published',
      metadata: { featured: true },
    },
    { uniqueBy: ['title'] }
  );
  assert.equal(upsertedPost.status, 'published');
  assert.equal(await posts.count({ where: { title: 'hello-title' } }), 1);

  await posts.insertIfAbsent(
    {
      title: 'insert-if-absent',
      status: 'draft',
      metadata: { featured: false },
    },
    { uniqueBy: ['title'] }
  );
  await posts.insertIfAbsent(
    {
      title: 'insert-if-absent',
      status: 'draft',
      metadata: { featured: false },
    },
    { uniqueBy: ['title'] }
  );
  assert.equal(await posts.count({ where: { title: 'insert-if-absent' } }), 1);

  const deletedPost = await posts.softDelete(firstPost.id);
  assert.ok(deletedPost.deleted_at);
  assert.equal(await posts.findById(firstPost.id), null);
  assert.equal((await posts.restore(firstPost.id)).deleted_at, null);
  assert.equal((await posts.findById(firstPost.id))?.id, firstPost.id);

  const beforeRollback = await messagesA.count();
  await assert.rejects(
    userAData.transaction(async (tx) => {
      await tx.document<HelloMessage>('hello_messages').insert({ message: 'rollback-me' });
      throw new Error('rollback sentinel');
    }),
    /rollback sentinel/
  );
  assert.equal(await messagesA.count(), beforeRollback);

  assert.deepEqual(
    await appPool.query('select * from public.module_documents').then((result) => result.rows),
    []
  );
  const userAVisibleRows = await queryAsSession<{ message: string }>(
    appPool,
    userA,
    `select data->>'message' as message from public.module_documents order by data->>'message'`
  );
  assert.deepEqual(
    userAVisibleRows.map((row) => row.message),
    ['claimed', 'once']
  );
  const userBVisibleRows = await queryAsSession(
    appPool,
    userB,
    `select * from public.module_documents`
  );
  assert.equal(userBVisibleRows.length, 0);

  await assert.rejects(
    queryAsSession(
      appPool,
      helloSession({ allowPublicWrite: false }),
      `insert into public."mod_hello__hello_posts"
       (product_id, module_id, scope_type, scope_id, title, status, metadata)
       values ('product_a', 'hello', 'public-read', null, 'direct-blocked', 'draft', '{}'::jsonb)`
    ),
    /row-level security/
  );

  const workspaceUserA = helloSession();
  const workspaceUserB = helloSession({
    workspaceId: 'workspace_b',
    userId: 'user_b',
    actorId: 'user_b',
  });
  const workspaceDataA = createPostgresModuleDataApi({
    contract: workspaceContract,
    database,
    session: workspaceUserA,
  });
  const workspaceDataB = createPostgresModuleDataApi({
    contract: workspaceContract,
    database,
    session: workspaceUserB,
  });
  const notesA = workspaceDataA.table<{
    id: string;
    title: string;
    body: string | null;
  }>('demo_notes');
  const insertedNote = await notesA.insert({
    title: 'workspace-alpha',
    body: 'workspace-a',
  });
  assert.equal(
    await workspaceDataB.table<{ id: string; title: string; body: string | null }>('demo_notes').findById(
      insertedNote.id
    ),
    null
  );
  assert.equal((await notesA.findById(insertedNote.id))?.title, 'workspace-alpha');

  const productUserA = helloSession();
  const productUserB = helloSession({
    productId: 'product_b',
    workspaceId: 'workspace_b',
    userId: 'user_b',
    actorId: 'user_b',
  });
  const productDataA = createPostgresModuleDataApi({
    contract: productContract,
    database,
    session: productUserA,
  });
  const productDataB = createPostgresModuleDataApi({
    contract: productContract,
    database,
    session: productUserB,
  });
  const productsA = productDataA.table<{
    id: string;
    sku: string;
    title: string;
    slug: string;
    price_cents: number;
    inventory: number;
  }>('products');
  const insertedProduct = await productsA.insert({
    sku: 'sku-alpha',
    title: 'Alpha',
    slug: 'alpha',
    price_cents: 1000,
    inventory: 5,
  });
  assert.equal(
    await productDataB.table<{
      id: string;
      sku: string;
      title: string;
      slug: string;
      price_cents: number;
      inventory: number;
    }>('products').findById(insertedProduct.id),
    null
  );
  assert.equal((await productsA.findById(insertedProduct.id))?.sku, 'sku-alpha');

  const expectedPolicyNames = [
    'module_documents__module_scope_policy',
    'mod_hello__hello_posts__module_scope_policy',
    'mod_capability_demo__demo_notes__module_scope_policy',
    'mod_shop_demo__products__module_scope_policy',
    'mod_shop_demo__coupons__module_scope_policy',
    'mod_shop_demo__orders__module_scope_policy',
  ];
  const policyRows = await appPool.query<{
    tablename: string;
    policyname: string;
    cmd: string;
    qual: string | null;
    with_check: string | null;
  }>(`
    select tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and policyname = any($1::text[])
    order by tablename, policyname
  `, [expectedPolicyNames]);
  assert.equal(policyRows.rows.length, expectedPolicyNames.length);
  const policyModuleIds: Record<string, string> = {
    module_documents__module_scope_policy: 'hello',
    mod_hello__hello_posts__module_scope_policy: 'hello',
    mod_capability_demo__demo_notes__module_scope_policy: 'capability-demo',
    mod_shop_demo__products__module_scope_policy: 'shop-demo',
    mod_shop_demo__coupons__module_scope_policy: 'shop-demo',
    mod_shop_demo__orders__module_scope_policy: 'shop-demo',
  };
  for (const policy of policyRows.rows) {
    const moduleId = policyModuleIds[policy.policyname];
    assert.ok(moduleId, `unexpected policy ${policy.policyname}`);
    assert.equal(policy.cmd, 'ALL');
    const moduleIdFragment =
      policy.policyname === 'module_documents__module_scope_policy'
        ? `module_id = current_setting('ploykit.module_id', true)`
        : `module_id = '${moduleId}'`;
    assertPolicyExpressionIncludes(policy.qual ?? '', [
      `product_id = current_setting('ploykit.product_id', true)`,
      moduleIdFragment,
      `scope_type = 'public-read'`,
      `scope_type = current_setting('ploykit.scope_type', true)`,
      `scope_id = current_setting('ploykit.scope_id', true)`,
    ]);
    assertPolicyExpressionIncludes(policy.with_check ?? '', [
      `product_id = current_setting('ploykit.product_id', true)`,
      moduleIdFragment,
      `scope_type = 'public-read'`,
      `scope_id is null`,
      `current_setting('ploykit.allow_public_write', true) = 'true'`,
      `scope_type = current_setting('ploykit.scope_type', true)`,
      `scope_id = current_setting('ploykit.scope_id', true)`,
    ]);
  }

  const factory = createPostgresModuleDataHostFactory({
    database,
    session: userA,
  });
  const hostData = factory({
    contract,
    request: new Request('http://localhost/api/hello'),
    user: { id: 'user_a', role: 'user' },
    params: {},
  });
  await hostData.document<HelloMessage>('hello_messages').insert({ message: 'factory' });
  assert.equal(await messagesA.exists({ where: { message: 'factory' } }), true);

  await appPool.end();
  await ownerPool.end();
});
