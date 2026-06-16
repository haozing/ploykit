import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  importModuleDataArgs,
  importModuleDataCliRunner,
  importModuleDataDryRun,
  importModuleDataLoader,
  importModuleDataPaths,
  importModuleDataPlan,
  importModuleDataResetSql,
  importModuleDataStaticCommands,
  importModuleDataTypes,
  type StaticDiagnostic,
  type StaticPlan,
} from './advanced-runtime-data-helpers';

test('data static command helper orchestrates plan generate types and verify', async () => {
  const { createModuleDataStaticCommands } = await importModuleDataStaticCommands();
  const previousExitCode = process.exitCode;
  const writes: string[] = [];
  const outputs: {
    success: boolean;
    changed?: string[];
    checkedModules?: number;
    count?: number;
    diagnostics: StaticDiagnostic[];
  }[] = [];
  const plan: StaticPlan = {
    moduleId: 'example',
    moduleRoot: 'modules/example',
    migrations: { mode: 'generated' },
  };
  const commands = createModuleDataStaticCommands({
    artifacts: {
      moduleMigrationFile: (moduleRoot) =>
        path.join(moduleRoot, 'migrations', '0001_generated.sql'),
      modulePlanContent: (inputPlan) => JSON.stringify(inputPlan),
      modulePlanFile: (moduleRoot) =>
        path.join(moduleRoot, '.ploykit', 'generated', 'data-plan.json'),
      moduleTypesFile: (moduleRoot) =>
        path.join(moduleRoot, '.ploykit', 'generated', 'data-types.ts'),
      verifyGeneratedArtifacts: (_results, diagnostics) =>
        diagnostics.push({ severity: 'error', code: 'STALE', message: 'stale' }),
      writeIfChanged: (file, content) => {
        writes.push(`${path.relative(process.cwd(), file)}:${content}`);
        return true;
      },
    },
    buildPlans: async () => [{ plan, diagnostics: [] }],
    generateMigrationSql: () => 'sql',
    generateTypes: () => 'types',
    parseCommandArgs: () => ({ values: new Map(), flags: new Set() }),
    printJson: (value) => {
      outputs.push(
        value as {
          success: boolean;
          changed?: string[];
          checkedModules?: number;
          count?: number;
          diagnostics: StaticDiagnostic[];
        }
      );
    },
    projectRoot: process.cwd(),
    toProjectPath: (file) => path.relative(process.cwd(), file).replace(/\\/g, '/'),
  });

  try {
    await commands.commandPlan([]);
    await commands.commandGenerate([]);
    await commands.commandTypes([]);
    await commands.commandVerify([]);

    assert.equal(outputs[0]?.success, true);
    assert.equal(outputs[0]?.count, 1);
    assert.deepEqual(outputs[1]?.changed, [
      'modules/example/.ploykit/generated/data-plan.json',
      'modules/example/migrations/0001_generated.sql',
    ]);
    assert.deepEqual(outputs[2]?.changed, ['modules/example/.ploykit/generated/data-types.ts']);
    assert.equal(outputs[3]?.success, false);
    assert.equal(outputs[3]?.checkedModules, 1);
    assert.equal(outputs[3]?.diagnostics[0]?.code, 'STALE');
    assert.equal(process.exitCode, 1);
    assert.ok(writes.some((entry) => entry.endsWith(':sql')));
    assert.ok(writes.some((entry) => entry.endsWith(':types')));
  } finally {
    process.exitCode = previousExitCode;
  }
});

test('data reset SQL helper quotes module and table identifiers', async () => {
  const { generateResetSql } = await importModuleDataResetSql();

  assert.equal(
    generateResetSql({
      moduleId: "tenant's-module",
      tables: [{ physicalName: 'mod_example__notes' }, { physicalName: 'has"quote' }],
    }),
    `-- Reset generated Data v2 objects for module tenant's-module.
delete from public.module_documents where module_id = 'tenant''s-module';
drop table if exists public."mod_example__notes" cascade;
drop table if exists public."has""quote" cascade;
delete from public.module_data_models where module_id = 'tenant''s-module';
delete from public.module_data_migrations where module_id = 'tenant''s-module';
delete from public.module_data_grants where module_id = 'tenant''s-module';
delete from public.module_data_checks where module_id = 'tenant''s-module';
`
  );
});

test('data CLI runner dispatches commands and reports usage or errors', async () => {
  const { runModuleDataCliCommand } = await importModuleDataCliRunner();
  const previousExitCode = process.exitCode;
  const calls: string[] = [];
  const outputs: unknown[] = [];
  const usages: string[] = [];

  try {
    process.exitCode = undefined;
    await runModuleDataCliCommand({
      argv: ['node', 'module-data', 'plan', 'modules/hello'],
      commands: {
        plan: (args) => {
          calls.push(`plan:${args.join(',')}`);
        },
      },
      createErrorDiagnostic: (error) => ({
        severity: 'error',
        code: 'ERR',
        message: error instanceof Error ? error.message : String(error),
      }),
      onFinally: () => {
        calls.push('finally:plan');
      },
      printJson: (value) => outputs.push(value),
      printUsage: (usage) => usages.push(usage),
      usage: 'usage text',
    });

    assert.deepEqual(calls, ['plan:modules/hello', 'finally:plan']);
    assert.equal(process.exitCode, undefined);

    await runModuleDataCliCommand({
      argv: ['node', 'module-data', 'unknown'],
      commands: {},
      createErrorDiagnostic: (error) => ({
        severity: 'error',
        code: 'ERR',
        message: String(error),
      }),
      onFinally: () => {
        calls.push('finally:unknown');
      },
      printJson: (value) => outputs.push(value),
      printUsage: (usage) => usages.push(usage),
      usage: 'usage text',
    });

    assert.equal(process.exitCode, 1);
    assert.deepEqual(usages, ['usage text']);
    assert.equal(calls.at(-1), 'finally:unknown');

    process.exitCode = undefined;
    await runModuleDataCliCommand({
      argv: ['node', 'module-data', 'boom'],
      commands: {
        boom: () => {
          throw new Error('broken command');
        },
      },
      createErrorDiagnostic: (error) => ({
        severity: 'error',
        code: 'MODULE_DATA_CLI_ERROR',
        message: error instanceof Error ? error.message : String(error),
      }),
      onFinally: () => {
        calls.push('finally:boom');
      },
      printJson: (value) => outputs.push(value),
      printUsage: (usage) => usages.push(usage),
    });

    assert.equal(process.exitCode, 1);
    assert.deepEqual(outputs.at(-1), {
      success: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'MODULE_DATA_CLI_ERROR',
          message: 'broken command',
        },
      ],
    });
    assert.equal(calls.at(-1), 'finally:boom');
  } finally {
    process.exitCode = previousExitCode;
  }
});

test('data type generation helper emits stable interfaces and accessors', async () => {
  const { documentFieldTs, generateTypes, tableColumnTs, tsIdentifier } =
    await importModuleDataTypes();

  assert.equal(tsIdentifier('123 weird-module$name', 'Data'), 'Module123weirdModule$nameData');
  assert.equal(documentFieldTs({ type: 'string', required: false }), 'string | null');
  assert.equal(documentFieldTs({ type: 'datetime', required: true }), 'string');
  assert.equal(tableColumnTs({ kind: 'jsonb' }), 'unknown');
  assert.equal(tableColumnTs({ kind: 'timestamp', nullable: true }), 'string | null');

  const output = generateTypes(
    {
      moduleId: '123 weird-module$name',
      documents: [
        {
          name: 'tenant_notes',
          fields: {
            title: { type: 'string', required: true },
            extra: { type: 'json', required: false },
          },
        },
      ],
      tables: [
        {
          name: 'audit_log',
          columns: {
            severity: { kind: 'text' },
            occurred_at: { kind: 'timestamp', nullable: true },
          },
        },
      ],
    },
    {
      standardColumns: [
        { name: 'id', ts: 'string' },
        { name: 'scope_id', ts: 'string | null' },
      ],
    }
  );

  assert.match(output, /export interface TenantNotesDocument \{/);
  assert.match(output, /  title: string;/);
  assert.match(output, /  extra: unknown \| null;/);
  assert.match(output, /export interface AuditLogTable \{/);
  assert.match(output, /  scope_id: string \| null;/);
  assert.match(output, /  occurred_at: string \| null;/);
  assert.match(output, /export interface Module123weirdModule\$nameData \{/);
  assert.match(output, /tenant_notes: ctx\.data\.document<TenantNotesDocument>\('tenant_notes'\)/);
  assert.match(output, /audit_log: ctx\.data\.table<AuditLogTable>\('audit_log'\)/);
});

test('data plan helper normalizes models and reports validation diagnostics', async () => {
  const {
    STANDARD_COLUMNS,
    createModuleDataPlanHelpers,
    moduleDataPhysicalTableName,
    normalizeColumn,
    normalizeDocumentField,
    normalizeTables,
    stableHash,
  } = await importModuleDataPlan();
  const helpers = createModuleDataPlanHelpers({
    diagnostic: (severity, code, message, path, fix, details) => ({
      severity,
      code,
      message,
      ...(path ? { path } : {}),
      ...(fix ? { fix } : {}),
      ...(details ? { details } : {}),
    }),
    toProjectPath: (file) => file.replace(/\\/g, '/'),
  });

  assert.equal(STANDARD_COLUMNS[0]?.name, 'id');
  assert.equal(moduleDataPhysicalTableName('shop-demo', 'orders'), 'mod_shop_demo__orders');
  assert.deepEqual(normalizeDocumentField('string?'), { type: 'string?', required: false });
  assert.deepEqual(normalizeColumn({ kind: 'uuid', primaryKey: true, defaultRandom: true }), {
    kind: 'uuid',
    nullable: false,
    primaryKey: true,
    defaultRandom: true,
  });
  assert.deepEqual(normalizeTables({ tables: { notes: { columns: {} } } }, 'acme'), [
    {
      name: 'notes',
      physicalName: 'mod_acme__notes',
      scope: 'workspace',
      columns: {},
      unique: [],
      indexes: [],
    },
  ]);

  const originalDefault = { nested: { enabled: true } };
  const result = helpers.createModuleDataPlan('modules/example', 'example', {
    version: 1,
    documents: {
      settings: {
        scope: 'user',
        fields: {
          profile: { type: 'json', required: false, default: originalDefault },
        },
      },
    },
    tables: {
      notes: {
        $$type: 'ploykit.data.table',
        scope: 'workspace',
        columns: {
          title: { kind: 'text', nullable: false },
        },
        unique: [['title']],
        indexes: [['missing_index_field']],
        relations: {
          owner: {
            table: 'unknown_table',
            local: 'missing_local',
            foreign: 'id',
            onDelete: 'explode',
          },
        },
      },
    },
    views: {
      bad_view: { source: '', scope: 'bad-scope' },
    },
    grants: {
      bad_grant: { model: 'missing_model', operations: [] },
    },
    checks: {
      bad_check: { model: '' },
    },
    migrations: {
      mode: 'bad-mode',
      dir: '../escape',
    },
  });

  originalDefault.nested.enabled = false;

  assert.equal(result.plan.moduleRoot, 'modules/example');
  assert.equal(result.plan.tables[0]?.physicalName, 'mod_example__notes');
  assert.equal(
    (
      result.plan.documents[0]?.fields.profile as {
        default?: { nested: { enabled: boolean } };
      }
    ).default?.nested.enabled,
    true
  );
  assert.equal(result.plan.schemaHash, stableHash({ ...result.plan, schemaHash: undefined }));
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code).sort(),
    [
      'MODULE_DATA_CHECK_MODEL_REQUIRED',
      'MODULE_DATA_GRANT_MODEL_UNKNOWN',
      'MODULE_DATA_GRANT_OPERATIONS_REQUIRED',
      'MODULE_DATA_MIGRATION_MODE_INVALID',
      'MODULE_DATA_TABLE_INDEX_FIELD_UNKNOWN',
      'MODULE_DATA_TABLE_RELATION_LOCAL_FIELD_UNKNOWN',
      'MODULE_DATA_TABLE_RELATION_ON_DELETE_INVALID',
      'MODULE_DATA_TABLE_RELATION_TARGET_UNKNOWN',
      'MODULE_DATA_VIEW_SOURCE_REQUIRED',
      'MODULE_DATA_SCOPE_INVALID',
      'MODULE_LOCAL_PATH_INVALID',
    ].sort()
  );
});

test('data dry-run helper builds migrate and reset payloads', async () => {
  const { createMigrationDryRunPayload, createResetDryRunPayload } = await importModuleDataDryRun();
  const warning = { severity: 'warning', code: 'WARN', message: 'manual migration' };
  const error = { severity: 'error', code: 'BAD', message: 'stale plan' };

  assert.deepEqual(
    createMigrationDryRunPayload(
      [
        {
          moduleId: 'hello',
          schemaHash: 'hash-1',
          projectPath: 'modules/hello/migrations/0001_generated.sql',
          bytes: 42,
        },
      ],
      [warning]
    ),
    {
      success: true,
      mode: 'dry-run',
      migrations: [
        {
          moduleId: 'hello',
          schemaHash: 'hash-1',
          path: 'modules/hello/migrations/0001_generated.sql',
          bytes: 42,
        },
      ],
      diagnostics: [warning],
    }
  );

  assert.deepEqual(createMigrationDryRunPayload([], [error]), {
    success: false,
    mode: 'dry-run',
    migrations: [],
    diagnostics: [error],
  });

  assert.deepEqual(
    createResetDryRunPayload([{ moduleId: 'hello', sql: 'drop table public.mod_hello' }], [error]),
    {
      success: false,
      mode: 'dry-run',
      resetPlans: [{ moduleId: 'hello', sql: 'drop table public.mod_hello' }],
      diagnostics: [error],
      next: 'Pass --force with DATABASE_URL to apply the reset.',
    }
  );
});

test('data loader helper unwraps module exports and reports load failures', async () => {
  const { createModuleDataLoader, moduleDefinitionUrl, readDefaultExport } =
    await importModuleDataLoader();
  const importedUrls: string[] = [];
  const loader = createModuleDataLoader({
    diagnostic: (severity, code, message, path, fix) => ({
      severity,
      code,
      message,
      ...(path ? { path } : {}),
      ...(fix ? { fix } : {}),
    }),
    importModule: async (url, parentUrl) => {
      importedUrls.push(`${url}|${parentUrl ?? ''}`);
      if (url.includes('bad-export')) {
        return { default: null };
      }
      if (url.includes('throws')) {
        throw new Error('module exploded');
      }
      return { default: { default: { id: 'loaded-module', data: { version: 1 } } } };
    },
    parentUrl: 'file:///parent.mjs',
    toProjectPath: (file) => file.replace(/\\/g, '/'),
  });

  assert.deepEqual(readDefaultExport({ default: { default: { id: 'nested' } } }), {
    id: 'nested',
  });
  assert.ok(
    moduleDefinitionUrl(path.join('modules', 'hello')).endsWith('/modules/hello/module.ts')
  );

  const loaded = await loader.loadModuleDefinition(path.join('modules', 'hello'));
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    assert.equal(loaded.definition.id, 'loaded-module');
  }
  assert.equal(importedUrls[0]?.endsWith('|file:///parent.mjs'), true);

  const invalid = await loader.loadModuleDefinition(path.join('modules', 'bad-export'));
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.deepEqual(invalid.result, {
      moduleRoot: 'modules/bad-export',
      moduleId: 'bad-export',
      hasData: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'MODULE_DATA_CONTRACT_LOAD_FAILED',
          message: 'Module modules/bad-export did not export a module definition.',
          path: 'modules/bad-export/module.ts',
          fix: 'Ensure module.ts exports defineModule(...) and compiles.',
        },
      ],
      plan: null,
    });
  }

  const failed = await loader.loadModuleDefinition(path.join('modules', 'throws'));
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.result.diagnostics[0]?.code, 'MODULE_DATA_CONTRACT_LOAD_FAILED');
    assert.equal(failed.result.diagnostics[0]?.message, 'module exploded');
    assert.equal(failed.result.diagnostics[0]?.path, 'modules/throws/module.ts');
  }
});

test('data path helper resolves local module paths and blocks escapes', async () => {
  const { resolveModuleLocalPath } = await importModuleDataPaths();
  const moduleRoot = path.join(process.cwd(), 'modules', 'hello');

  assert.equal(
    resolveModuleLocalPath(moduleRoot, './migrations/0001_generated.sql'),
    path.resolve(moduleRoot, 'migrations', '0001_generated.sql')
  );
  assert.throws(
    () => resolveModuleLocalPath(moduleRoot, 'migrations/0001_generated.sql'),
    /must be a local "\.\/" path/
  );
  assert.throws(() => resolveModuleLocalPath(moduleRoot, './'), /escapes module root/);
  assert.throws(
    () => resolveModuleLocalPath(moduleRoot, './../outside.sql'),
    /escapes module root/
  );
});

test('data args helper parses targets filters flags and value options', async () => {
  const { parseCommandArgs } = await importModuleDataArgs();
  const parsed = parseCommandArgs([
    'modules/hello',
    '--module',
    'hello',
    '--module',
    'shop-demo',
    '--database-url',
    'postgres://migration',
    '--app-database-url',
    'postgres://app',
    '--schema',
    'tenant',
    '--dry-run',
    '--require-app-role-safety',
  ]);

  assert.equal(parsed.targetPath, 'modules/hello');
  assert.deepEqual([...parsed.moduleFilter].sort(), ['hello', 'shop-demo']);
  assert.deepEqual([...parsed.flags].sort(), ['dry-run', 'require-app-role-safety']);
  assert.equal(parsed.values.get('databaseUrl'), 'postgres://migration');
  assert.equal(parsed.values.get('appDatabaseUrl'), 'postgres://app');
  assert.equal(parsed.values.get('schema'), 'tenant');

  assert.throws(() => parseCommandArgs(['--module']), /Expected module id/);
  assert.throws(() => parseCommandArgs(['--database-url']), /Expected database URL/);
  assert.throws(() => parseCommandArgs(['--app-database-url']), /Expected database URL/);
  assert.throws(() => parseCommandArgs(['--schema']), /Expected schema/);
});
