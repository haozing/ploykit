import assert from 'node:assert/strict';
import test from 'node:test';
import {
  importModuleDataDbVerifier,
  importModuleDataDbIntrospection,
  importModuleDataDbSchemaVerifier,
  importModuleDataRls,
  importModuleDataRoleSafety,
  importModuleDataVerifyDbCommand,
  type DbSchemaDiagnostic,
  type QueryPool,
  type RoleSafetyDiagnostic,
  type VerifyDbDiagnostic,
} from './advanced-runtime-data-helpers';

test('data DB verifier composition wires schema RLS role and verify-db command', async () => {
  const { createModuleDataDbVerifier } = await importModuleDataDbVerifier();
  const previousExitCode = process.exitCode;
  const calls: string[] = [];
  const closedPools: string[] = [];
  const outputs: {
    success: boolean;
    checkedModules: number;
    diagnostics: VerifyDbDiagnostic[];
  }[] = [];
  const standardColumns = new Map([
    ['id', { type: 'uuid', nullable: false }],
    ['product_id', { type: 'text', nullable: false }],
    ['module_id', { type: 'text', nullable: false }],
    ['scope_type', { type: 'text', nullable: false }],
    ['scope_id', { type: 'text', nullable: true }],
    ['created_at', { type: 'timestamp with time zone', nullable: false }],
    ['updated_at', { type: 'timestamp with time zone', nullable: false }],
    ['deleted_at', { type: 'timestamp with time zone', nullable: true }],
    ['created_by', { type: 'text', nullable: true }],
    ['updated_by', { type: 'text', nullable: true }],
    ['title', { type: 'text', nullable: false }],
  ]);
  const policyUsing = [
    "product_id = current_setting('ploykit.product_id', true)",
    "module_id = 'example'",
    "scope_type = 'public-read'",
    "scope_type = current_setting('ploykit.scope_type', true)",
    "scope_id = current_setting('ploykit.scope_id', true)",
  ].join(' and ');
  const policyWithCheck = [
    "product_id = current_setting('ploykit.product_id', true)",
    "module_id = 'example'",
    "scope_type = 'public-read'",
    'scope_id is null',
    "current_setting('ploykit.allow_public_write', true) = 'true'",
    "scope_type = current_setting('ploykit.scope_type', true)",
    "scope_id = current_setting('ploykit.scope_id', true)",
  ].join(' and ');
  const command = createModuleDataDbVerifier({
    appDatabaseUrlFromOptions: (options) => options.values.get('appDatabaseUrl') ?? '',
    createPgPool: async (databaseUrl) => ({
      url: databaseUrl,
      async end() {
        closedPools.push(databaseUrl);
      },
    }),
    databaseUrlFromOptions: (options) => options.values.get('databaseUrl') ?? '',
    dbColumnType: (column) => column.kind,
    diagnostic: (severity, code, message, path, fix, details) => ({
      severity,
      code,
      message,
      ...(path ? { path } : {}),
      ...(fix ? { fix } : {}),
      ...(details ? { details } : {}),
    }),
    metadataHash: async (pool, moduleId, kind, name) => {
      calls.push(`metadata:${pool.url}:${moduleId}:${kind}:${name}`);
      return 'hash-ok';
    },
    printJson: (value) => {
      outputs.push(
        value as {
          success: boolean;
          checkedModules: number;
          diagnostics: VerifyDbDiagnostic[];
        }
      );
    },
    quoteString: (value) => `'${value}'`,
    readCurrentRoleSafety: async (pool, schema, tableNames) => {
      calls.push(`role:${pool.url}:${schema}:${tableNames.join(',')}`);
      return {
        role: {
          rolname: 'app_role',
          rolsuper: false,
          rolbypassrls: false,
          rolcreatedb: false,
          rolcreaterole: false,
        },
        canCreateInSchema: false,
        ownedTables: [],
      };
    },
    readRlsPolicies: async (pool, schema, tableName) => {
      calls.push(`rls-policies:${pool.url}:${schema}:${tableName}`);
      return [
        {
          policyname: `${tableName}__module_scope_policy`,
          cmd: 'ALL',
          qual: policyUsing,
          with_check: policyWithCheck,
        },
      ];
    },
    readRlsState: async (pool, schema, tableName) => {
      calls.push(`rls-state:${pool.url}:${schema}:${tableName}`);
      return { relrowsecurity: true, relforcerowsecurity: true };
    },
    readTableColumns: async (pool, schema, tableName) => {
      calls.push(`columns:${pool.url}:${schema}:${tableName}`);
      return standardColumns;
    },
    stableHash: () => 'hash-ok',
    tableExists: async (pool, schema, tableName) => {
      calls.push(`table:${pool.url}:${schema}:${tableName}`);
      return true;
    },
  });

  try {
    await command.commandVerifyDb([], {
      parseCommandArgs: () => ({
        values: new Map([
          ['databaseUrl', 'postgres://migration'],
          ['appDatabaseUrl', 'postgres://app'],
          ['schema', 'custom'],
        ]),
        flags: new Set(),
      }),
      buildPlans: async () => [
        {
          plan: {
            moduleId: 'example',
            moduleRoot: 'modules/example',
            documents: [],
            tables: [
              {
                name: 'notes',
                physicalName: 'mod_example__notes',
                columns: { title: { kind: 'text', nullable: false } },
              },
            ],
          },
          diagnostics: [],
        },
      ],
    });

    assert.equal(outputs[0]?.success, true);
    assert.equal(outputs[0]?.checkedModules, 1);
    assert.deepEqual(outputs[0]?.diagnostics, []);
    assert.ok(calls.includes('table:postgres://migration:custom:mod_example__notes'));
    assert.ok(calls.includes('columns:postgres://migration:custom:mod_example__notes'));
    assert.ok(calls.includes('rls-state:postgres://migration:custom:mod_example__notes'));
    assert.ok(calls.includes('rls-policies:postgres://migration:custom:mod_example__notes'));
    assert.ok(calls.includes('metadata:postgres://migration:example:table:notes'));
    assert.ok(calls.includes('role:postgres://migration:custom:mod_example__notes'));
    assert.ok(calls.includes('role:postgres://app:custom:mod_example__notes'));
    assert.deepEqual(closedPools, ['postgres://migration', 'postgres://app']);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test('data verify-db RLS helper reports policy drift diagnostics', async () => {
  const { createModuleDataRlsVerifier } = await importModuleDataRls();
  const verifier = createModuleDataRlsVerifier({
    quoteString: (value) => `'${value}'`,
    readRlsState: async () => ({ relrowsecurity: true, relforcerowsecurity: true }),
    readRlsPolicies: async () => [
      {
        policyname: 'notes__module_scope_policy',
        cmd: 'SELECT',
        qual: "product_id = current_setting('ploykit.product_id', true)",
        with_check: "product_id = current_setting('ploykit.product_id', true)",
      },
      {
        policyname: 'unexpected_policy',
        cmd: 'ALL',
        qual: 'true',
        with_check: 'true',
      },
    ],
    pushDbError: (diagnostics, code) => diagnostics.push({ code }),
  });
  const diagnostics: { code: string }[] = [];

  await verifier.verifyRlsTable(
    {},
    diagnostics,
    'public',
    'notes',
    'notes__module_scope_policy',
    'modules/example:tables.notes',
    verifier.expectedModuleTableScopePolicyFragments('example')
  );

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code).sort(),
    [
      'MODULE_DATA_DB_RLS_POLICY_COMMAND_MISMATCH',
      'MODULE_DATA_DB_RLS_POLICY_EXTRA',
      'MODULE_DATA_DB_RLS_POLICY_USING_MISMATCH',
      'MODULE_DATA_DB_RLS_POLICY_WITH_CHECK_MISMATCH',
    ].sort()
  );
});

test('data verify-db DB introspection helper maps catalog snapshots', async () => {
  const { metadataHash, readCurrentRoleSafety, readTableColumns, tableExists } =
    await importModuleDataDbIntrospection();
  const queries: { sql: string; params?: unknown[] }[] = [];
  const pool: QueryPool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('to_regclass')) {
        return { rows: [{ exists: true }] };
      }
      if (sql.includes('information_schema.columns')) {
        return {
          rows: [
            { column_name: 'title', data_type: 'text', is_nullable: 'NO' },
            { column_name: 'metadata', data_type: 'jsonb', is_nullable: 'YES' },
          ],
        };
      }
      if (sql.includes('pg_roles')) {
        return {
          rows: [
            {
              rolname: 'app_role',
              rolsuper: false,
              rolbypassrls: false,
              rolcreatedb: false,
              rolcreaterole: false,
            },
          ],
        };
      }
      if (sql.includes('has_schema_privilege')) {
        return { rows: [{ can_create: false }] };
      }
      if (sql.includes('pg_get_userbyid')) {
        return { rows: [{ relname: 'mod_example__notes', owner: 'app_role' }] };
      }
      if (sql.includes('module_data_models')) {
        return { rows: [{ schema_hash: 'hash-1' }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  assert.equal(await tableExists(pool, 'public', 'mod_example__notes'), true);
  assert.deepEqual(
    [...(await readTableColumns(pool, 'public', 'mod_example__notes')).entries()],
    [
      ['title', { type: 'text', nullable: false }],
      ['metadata', { type: 'jsonb', nullable: true }],
    ]
  );
  assert.deepEqual(await readCurrentRoleSafety(pool, 'public', ['mod_example__notes']), {
    role: {
      rolname: 'app_role',
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
    },
    canCreateInSchema: false,
    ownedTables: ['mod_example__notes'],
  });
  assert.equal(await metadataHash(pool, 'example', 'table', 'notes'), 'hash-1');
  assert.deepEqual(queries[0]?.params, ['public."mod_example__notes"']);
});

test('data verify-db role safety helper reports role risk diagnostics', async () => {
  const { createModuleDataRoleSafetyVerifier } = await importModuleDataRoleSafety();
  const verifier = createModuleDataRoleSafetyVerifier({
    diagnostic: (severity, code, message, path, fix, details) => ({
      severity,
      code,
      message,
      ...(path ? { path } : {}),
      ...(fix ? { fix } : {}),
      ...(details ? { details } : {}),
    }),
    readCurrentRoleSafety: async () => ({
      role: {
        rolname: 'app_owner',
        rolsuper: true,
        rolbypassrls: true,
        rolcreatedb: true,
        rolcreaterole: false,
      },
      canCreateInSchema: true,
      ownedTables: ['module_documents', 'mod_example__notes'],
    }),
  });
  const diagnostics: RoleSafetyDiagnostic[] = [];

  await verifier.verifyDatabaseRoleSafety({}, diagnostics, 'public', ['module_documents'], {
    source: 'app-runtime',
    severity: 'error',
    path: 'PLOYKIT_APP_DATABASE_URL.role',
  });
  verifier.pushAppRoleUrlRequired(diagnostics);
  verifier.pushAppRoleSafetySkipped(diagnostics);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    [
      'MODULE_DATA_DB_ROLE_BYPASS_RLS',
      'MODULE_DATA_DB_ROLE_DDL_PRIVILEGES',
      'MODULE_DATA_DB_ROLE_OWNS_RLS_TABLES',
      'MODULE_DATA_DB_APP_ROLE_URL_REQUIRED',
      'MODULE_DATA_DB_APP_ROLE_SAFETY_SKIPPED',
    ]
  );
  assert.equal(diagnostics[0]?.severity, 'error');
  assert.equal(diagnostics[0]?.path, 'PLOYKIT_APP_DATABASE_URL.role.bypassRls');
  assert.deepEqual(diagnostics[0]?.details, {
    role: 'app_owner',
    source: 'app-runtime',
    rolsuper: true,
    rolbypassrls: true,
  });
  assert.deepEqual(
    verifier.collectRlsTableNames([
      {
        plan: {
          documents: [{}],
          tables: [{ physicalName: 'mod_example__notes' }],
        },
      },
    ]),
    ['mod_example__notes', 'module_documents']
  );
});

test('data verify-db schema verifier reports table column and metadata drift', async () => {
  const { createModuleDataDbSchemaVerifier } = await importModuleDataDbSchemaVerifier();
  const rlsCalls: string[] = [];
  const verifier = createModuleDataDbSchemaVerifier({
    dbColumnType: (column) =>
      column.kind === 'timestamp' ? 'timestamp with time zone' : column.kind,
    metadataHash: async (_pool, _moduleId, kind) =>
      kind === 'document' ? 'wrong-doc' : 'wrong-table',
    pushDbError: (diagnostics, code, _message, path) => diagnostics.push({ code, path }),
    readTableColumns: async (_pool, _schema, tableName) => {
      if (tableName === 'module_documents') {
        return new Map([
          ['id', { type: 'uuid', nullable: false }],
          ['product_id', { type: 'text', nullable: false }],
          ['module_id', { type: 'text', nullable: false }],
          ['scope_type', { type: 'text', nullable: false }],
          ['scope_id', { type: 'text', nullable: true }],
          ['created_at', { type: 'timestamp with time zone', nullable: false }],
          ['updated_at', { type: 'timestamp with time zone', nullable: false }],
          ['deleted_at', { type: 'timestamp with time zone', nullable: true }],
          ['created_by', { type: 'text', nullable: true }],
          ['updated_by', { type: 'text', nullable: true }],
          ['document_name', { type: 'text', nullable: false }],
          ['data', { type: 'jsonb', nullable: false }],
        ]);
      }
      return new Map([
        ['id', { type: 'uuid', nullable: false }],
        ['product_id', { type: 'text', nullable: false }],
        ['module_id', { type: 'text', nullable: false }],
        ['scope_type', { type: 'text', nullable: false }],
        ['scope_id', { type: 'text', nullable: true }],
        ['created_at', { type: 'timestamp with time zone', nullable: false }],
        ['updated_at', { type: 'timestamp with time zone', nullable: false }],
        ['deleted_at', { type: 'timestamp with time zone', nullable: true }],
        ['created_by', { type: 'text', nullable: true }],
        ['updated_by', { type: 'text', nullable: true }],
        ['title', { type: 'jsonb', nullable: true }],
      ]);
    },
    rlsVerifier: {
      expectedModuleDocumentScopePolicyFragments: () => ({
        usingFragments: ['document'],
        withCheckFragments: ['document'],
      }),
      expectedModuleTableScopePolicyFragments: () => ({
        usingFragments: ['table'],
        withCheckFragments: ['table'],
      }),
      verifyRlsTable: async (_pool, _diagnostics, _schema, tableName, policyName) => {
        rlsCalls.push(`${tableName}:${policyName}`);
      },
    },
    stableHash: (value) =>
      typeof value === 'object' && value && 'name' in value ? `expected-${String(value.name)}` : '',
    tableExists: async (_pool, _schema, tableName) => tableName !== 'module_data_checks',
  });
  const diagnostics: DbSchemaDiagnostic[] = [];

  await verifier.verifyModulePlanInDatabase(
    {},
    diagnostics,
    {
      moduleId: 'example',
      moduleRoot: 'modules/example',
      documents: [{ name: 'settings' }],
      tables: [
        {
          name: 'notes',
          physicalName: 'mod_example__notes',
          columns: {
            title: { kind: 'text', nullable: false },
            status: { kind: 'text', nullable: false },
          },
        },
      ],
    },
    'public'
  );

  assert.deepEqual(rlsCalls, [
    'module_documents:module_documents__module_scope_policy',
    'mod_example__notes:mod_example__notes__module_scope_policy',
  ]);
  assert.ok(
    diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 'MODULE_DATA_DB_METADATA_TABLE_MISSING' &&
        diagnostic.path === 'modules/example:metadata'
    )
  );
  assert.ok(
    diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 'MODULE_DATA_DB_METADATA_HASH_MISMATCH' &&
        diagnostic.path === 'modules/example:documents.settings'
    )
  );
  assert.ok(
    diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 'MODULE_DATA_DB_COLUMN_TYPE_MISMATCH' &&
        diagnostic.path === 'modules/example:tables.notes.title'
    )
  );
  assert.ok(
    diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 'MODULE_DATA_DB_COLUMN_NULLABILITY_MISMATCH' &&
        diagnostic.path === 'modules/example:tables.notes.title'
    )
  );
  assert.ok(
    diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 'MODULE_DATA_DB_COLUMN_MISSING' &&
        diagnostic.path === 'modules/example:tables.notes.status'
    )
  );
});

test('data verify-db command helper orchestrates database and app role checks', async () => {
  const { createModuleDataVerifyDbCommand } = await importModuleDataVerifyDbCommand();
  const previousExitCode = process.exitCode;
  const outputs: {
    success: boolean;
    diagnostics: VerifyDbDiagnostic[];
    checkedModules: number;
  }[] = [];
  const closedPools: string[] = [];
  const schemaCalls: string[] = [];
  const roleCalls: string[] = [];
  const command = createModuleDataVerifyDbCommand({
    appDatabaseUrlFromOptions: (options) => options.values.get('appDatabaseUrl') ?? '',
    createPgPool: async (databaseUrl) => ({
      url: databaseUrl,
      async end() {
        closedPools.push(databaseUrl);
      },
    }),
    databaseUrlFromOptions: (options) => options.values.get('databaseUrl') ?? '',
    diagnostic: (severity, code, message, path, fix) => ({
      severity,
      code,
      message,
      ...(path ? { path } : {}),
      ...(fix ? { fix } : {}),
    }),
    printJson: (value) => {
      outputs.push(
        value as {
          success: boolean;
          diagnostics: VerifyDbDiagnostic[];
          checkedModules: number;
        }
      );
    },
    roleSafetyVerifier: {
      collectRlsTableNames: () => ['module_documents', 'mod_example__notes'],
      pushAppRoleSafetySkipped: (diagnostics) =>
        diagnostics.push({
          severity: 'warning',
          code: 'MODULE_DATA_DB_APP_ROLE_SAFETY_SKIPPED',
          message: 'skipped',
        }),
      pushAppRoleUrlRequired: (diagnostics) =>
        diagnostics.push({
          severity: 'error',
          code: 'MODULE_DATA_DB_APP_ROLE_URL_REQUIRED',
          message: 'required',
        }),
      verifyDatabaseRoleSafety: async (pool, diagnostics, _schema, tableNames, input) => {
        roleCalls.push(`${pool.url}:${input.source}:${tableNames.join(',')}`);
        if (input.source === 'app-runtime') {
          diagnostics.push({
            severity: 'error',
            code: 'MODULE_DATA_DB_ROLE_BYPASS_RLS',
            message: 'bad app role',
          });
        }
      },
    },
    schemaVerifier: {
      verifyModulePlanInDatabase: async (pool, _diagnostics, plan, schema) => {
        schemaCalls.push(`${pool.url}:${schema}:${plan.moduleId}`);
      },
    },
  });
  const buildPlans = async () => [{ plan: { moduleId: 'example' }, diagnostics: [] }];

  try {
    await command.commandVerifyDb([], {
      parseCommandArgs: () => ({
        values: new Map([
          ['databaseUrl', 'postgres://migration'],
          ['appDatabaseUrl', 'postgres://app'],
          ['schema', 'custom'],
        ]),
        flags: new Set(),
      }),
      buildPlans,
    });

    assert.deepEqual(schemaCalls, ['postgres://migration:custom:example']);
    assert.deepEqual(roleCalls, [
      'postgres://migration:verify-db:module_documents,mod_example__notes',
      'postgres://app:app-runtime:module_documents,mod_example__notes',
    ]);
    assert.deepEqual(closedPools, ['postgres://migration', 'postgres://app']);
    assert.equal(outputs[0]?.success, false);
    assert.equal(outputs[0]?.checkedModules, 1);
    assert.ok(
      outputs[0]?.diagnostics.some(
        (diagnostic) => diagnostic.code === 'MODULE_DATA_DB_ROLE_BYPASS_RLS'
      )
    );

    outputs.length = 0;
    await command.commandVerifyDb([], {
      parseCommandArgs: () => ({
        values: new Map(),
        flags: new Set(['require-app-role-safety']),
      }),
      buildPlans: async () => [{ plan: { moduleId: 'example' }, diagnostics: [] }],
    });

    assert.deepEqual(
      outputs[0]?.diagnostics.map((diagnostic) => diagnostic.code),
      ['MODULE_DATA_VERIFY_DB_DATABASE_URL_REQUIRED', 'MODULE_DATA_DB_APP_ROLE_URL_REQUIRED']
    );
  } finally {
    process.exitCode = previousExitCode;
  }
});
