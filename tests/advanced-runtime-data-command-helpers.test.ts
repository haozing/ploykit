import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  importModuleDataApplyCommands,
  importModuleDataCommandDependencies,
  importModuleDataDbMutation,
  type MutationDiagnostic,
  type StaticDiagnostic,
  type StaticPlan,
  writeDataDiffFixture,
} from './advanced-runtime-data-helpers';

test('data DB mutation runner applies migrations resets and records rollback diagnostics', async () => {
  const { createModuleDataDbMutationRunner } = await importModuleDataDbMutation();
  const queries: string[] = [];
  const closedPools: string[] = [];
  const runner = createModuleDataDbMutationRunner({
    createPgPool: async (databaseUrl) => ({
      async query(sql) {
        queries.push(`${databaseUrl}:${sql}`);
        if (sql === 'select fail') {
          throw new Error('boom');
        }
      },
      async end() {
        closedPools.push(databaseUrl);
      },
    }),
    diagnostic: (severity, code, message, path, fix) => ({
      severity,
      code,
      message,
      ...(path ? { path } : {}),
      ...(fix ? { fix } : {}),
    }),
    readMigrationSql: (file) => (file.includes('bad') ? 'select fail' : 'select ok'),
  });
  const migrateDiagnostics: MutationDiagnostic[] = [];

  const applied = await runner.applyMigrationEntries(
    'postgres://migration',
    [
      {
        moduleId: 'ok',
        schemaHash: 'hash-ok',
        projectPath: 'modules/ok/migrations/0001_generated.sql',
        migrationFile: 'ok.sql',
      },
      {
        moduleId: 'bad',
        schemaHash: 'hash-bad',
        projectPath: 'modules/bad/migrations/0001_generated.sql',
        migrationFile: 'bad.sql',
      },
    ],
    migrateDiagnostics
  );

  assert.deepEqual(applied, [
    {
      moduleId: 'ok',
      schemaHash: 'hash-ok',
      path: 'modules/ok/migrations/0001_generated.sql',
    },
  ]);
  assert.deepEqual(
    migrateDiagnostics.map((diagnostic) => diagnostic.code),
    ['MODULE_DATA_MIGRATE_FAILED']
  );
  assert.equal(migrateDiagnostics[0]?.path, 'modules/bad/migrations/0001_generated.sql');
  assert.deepEqual(queries, [
    'postgres://migration:begin',
    'postgres://migration:select ok',
    'postgres://migration:commit',
    'postgres://migration:begin',
    'postgres://migration:select fail',
    'postgres://migration:rollback',
  ]);
  assert.deepEqual(closedPools, ['postgres://migration']);

  const resetDiagnostics: MutationDiagnostic[] = [];
  const reset = await runner.applyResetPlans(
    'postgres://reset',
    [{ moduleId: 'ok', sql: 'delete from module_documents' }],
    resetDiagnostics
  );

  assert.deepEqual(reset, [{ moduleId: 'ok' }]);
  assert.equal(resetDiagnostics.length, 0);
  assert.ok(queries.includes('postgres://reset:delete from module_documents'));

  runner.pushMigrateDatabaseUrlRequired(migrateDiagnostics);
  runner.pushResetDatabaseUrlRequired(resetDiagnostics);
  assert.equal(migrateDiagnostics.at(-1)?.code, 'MODULE_DATA_MIGRATE_DATABASE_URL_REQUIRED');
  assert.equal(resetDiagnostics.at(-1)?.code, 'MODULE_DATA_RESET_DATABASE_URL_REQUIRED');
});

test('data apply command helper orchestrates migrate and reset flows', async () => {
  const { createModuleDataApplyCommands } = await importModuleDataApplyCommands();
  const previousExitCode = process.exitCode;
  const outputs: {
    success: boolean;
    mode: string;
    migrations?: unknown[];
    applied?: unknown[];
    resetPlans?: { moduleId: string; sql: string }[];
    reset?: unknown[];
    diagnostics: StaticDiagnostic[];
  }[] = [];
  const calls: string[] = [];
  const plan: StaticPlan & { tables: { physicalName: string }[] } = {
    moduleId: 'hello',
    moduleRoot: 'modules/hello',
    migrations: { mode: 'generated' },
    tables: [{ physicalName: 'mod_hello__notes' }],
  };
  const parseCommandArgs = (args: string[]) => {
    const flags = new Set<string>();
    const values = new Map<string, string>();
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === '--database-url') {
        values.set('databaseUrl', args[index + 1] ?? '');
        index += 1;
      } else if (arg.startsWith('--')) {
        flags.add(arg.slice(2));
      }
    }
    return { flags, values };
  };
  const command = createModuleDataApplyCommands({
    artifacts: {
      collectMigrationEntries: (results, diagnostics) => {
        calls.push(`collect:${results.length}:${diagnostics.length}`);
        return [
          {
            moduleId: 'hello',
            schemaHash: 'hash-1',
            projectPath: 'modules/hello/migrations/0001_generated.sql',
            bytes: 42,
            migrationFile: 'hello.sql',
          },
        ];
      },
    },
    buildPlans: async (options) => {
      calls.push(`build:${[...options.flags].sort().join(',')}`);
      return [{ plan, diagnostics: [] }];
    },
    createMigrationDryRunPayload: (entries, diagnostics) => ({
      success: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
      mode: 'dry-run',
      migrations: entries,
      diagnostics,
    }),
    createResetDryRunPayload: (resetPlans, diagnostics) => ({
      success: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
      mode: 'dry-run',
      resetPlans,
      diagnostics,
    }),
    databaseUrlFromOptions: (options) => options.values.get('databaseUrl') ?? '',
    dbMutations: {
      applyMigrationEntries: async (databaseUrl, entries, diagnostics) => {
        calls.push(`apply-migrate:${databaseUrl}:${entries.length}`);
        if (databaseUrl.includes('fail')) {
          diagnostics.push({ severity: 'error', code: 'MIGRATE_FAILED', message: 'failed' });
          return [];
        }
        return [{ moduleId: 'hello', schemaHash: 'hash-1', path: 'modules/hello/migration.sql' }];
      },
      applyResetPlans: async (databaseUrl, resetPlans, diagnostics) => {
        calls.push(`apply-reset:${databaseUrl}:${resetPlans.length}`);
        if (databaseUrl.includes('fail')) {
          diagnostics.push({ severity: 'error', code: 'RESET_FAILED', message: 'failed' });
          return [];
        }
        return resetPlans.map((resetPlan) => ({ moduleId: resetPlan.moduleId }));
      },
      hasErrors: (diagnostics) => diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
      pushMigrateDatabaseUrlRequired: (diagnostics) =>
        diagnostics.push({
          severity: 'error',
          code: 'MODULE_DATA_MIGRATE_DATABASE_URL_REQUIRED',
          message: 'database url required',
        }),
      pushResetDatabaseUrlRequired: (diagnostics) =>
        diagnostics.push({
          severity: 'error',
          code: 'MODULE_DATA_RESET_DATABASE_URL_REQUIRED',
          message: 'database url required',
        }),
    },
    generateResetSql: (inputPlan) => `reset ${inputPlan.moduleId}`,
    parseCommandArgs,
    printJson: (value) => {
      outputs.push(
        value as {
          success: boolean;
          mode: string;
          migrations?: unknown[];
          applied?: unknown[];
          resetPlans?: { moduleId: string; sql: string }[];
          reset?: unknown[];
          diagnostics: StaticDiagnostic[];
        }
      );
    },
  });

  try {
    process.exitCode = undefined;
    await command.commandMigrate(['--dry-run']);
    assert.equal(outputs.at(-1)?.success, true);
    assert.equal(outputs.at(-1)?.mode, 'dry-run');
    assert.equal(outputs.at(-1)?.migrations?.length, 1);
    assert.equal(process.exitCode, undefined);

    await command.commandMigrate([]);
    assert.equal(outputs.at(-1)?.success, false);
    assert.equal(outputs.at(-1)?.mode, 'psql');
    assert.equal(outputs.at(-1)?.diagnostics[0]?.code, 'MODULE_DATA_MIGRATE_DATABASE_URL_REQUIRED');
    assert.equal(process.exitCode, 1);

    process.exitCode = undefined;
    await command.commandMigrate(['--database-url', 'postgres://ok']);
    assert.equal(outputs.at(-1)?.success, true);
    assert.equal(outputs.at(-1)?.mode, 'pg');
    assert.equal(outputs.at(-1)?.applied?.length, 1);
    assert.equal(process.exitCode, undefined);

    await command.commandReset([]);
    assert.equal(outputs.at(-1)?.success, true);
    assert.equal(outputs.at(-1)?.mode, 'dry-run');
    assert.deepEqual(outputs.at(-1)?.resetPlans, [{ moduleId: 'hello', sql: 'reset hello' }]);

    await command.commandReset(['--force', '--database-url', 'postgres://ok']);
    assert.equal(outputs.at(-1)?.success, true);
    assert.equal(outputs.at(-1)?.mode, 'pg');
    assert.deepEqual(outputs.at(-1)?.reset, [{ moduleId: 'hello' }]);
    assert.equal(process.exitCode, undefined);
    assert.ok(calls.includes('apply-migrate:postgres://ok:1'));
    assert.ok(calls.includes('apply-reset:postgres://ok:1'));
  } finally {
    process.exitCode = previousExitCode;
  }
});

test('data command dependency helper wires static apply and verify-db commands', async () => {
  const { createModuleDataCommandDependencies } = await importModuleDataCommandDependencies();
  const previousExitCode = process.exitCode;
  const fixtureRoot = writeDataDiffFixture({
    'module.ts': `
      import { defineModule, table, text } from '@ploykit/module-sdk';

      export default defineModule({
        id: 'data-wiring-fixture',
        version: '1.0.0',
        data: {
          version: 1,
          tables: {
            notes: table({
              scope: 'workspace',
              columns: {
                title: text().notNull(),
              },
            }),
          },
          migrations: {
            mode: 'generated',
            dir: './migrations',
          },
        },
      });
    `,
  });
  const outputs: {
    success: boolean;
    mode: string;
    count?: number;
    checkedModules?: number;
    diagnostics: { code: string; severity: string }[];
  }[] = [];
  const dependencies = createModuleDataCommandDependencies({
    diagnostic: (severity, code, message, path, fix, details) => ({
      severity,
      code,
      message,
      ...(path ? { path } : {}),
      ...(fix ? { fix } : {}),
      ...(details ? { details } : {}),
    }),
    importModule: async () =>
      import(pathToFileURL(path.join(process.cwd(), fixtureRoot, 'module.ts')).href),
    parentUrl: pathToFileURL(path.join(process.cwd(), 'scripts', 'module-data.mjs')).href,
    printJson: (value) => {
      outputs.push(
        value as {
          success: boolean;
          mode: string;
          count?: number;
          checkedModules?: number;
          diagnostics: { code: string; severity: string }[];
        }
      );
    },
    projectRoot: process.cwd(),
  });

  try {
    assert.deepEqual(Object.keys(dependencies.commands).sort(), [
      'generate',
      'migrate',
      'plan',
      'reset',
      'types',
      'verify',
      'verify-db',
    ]);
    assert.equal(
      dependencies.toProjectPath(path.join(process.cwd(), fixtureRoot)),
      fixtureRoot.replace(/\\/g, '/')
    );

    const parsed = dependencies.parseCommandArgs([fixtureRoot, '--module', 'data-wiring-fixture']);
    const results = await dependencies.buildPlans(parsed);
    assert.equal(results.length, 1);
    assert.equal(results[0]?.moduleId, 'data-wiring-fixture');
    assert.equal(results[0]?.plan?.moduleId, 'data-wiring-fixture');

    await dependencies.commands.plan([fixtureRoot]);
    assert.equal(outputs.at(-1)?.success, true);
    assert.equal(outputs.at(-1)?.mode, 'static');
    assert.equal(outputs.at(-1)?.count, 1);

    await dependencies.commands['verify-db']([fixtureRoot]);
    assert.equal(outputs.at(-1)?.success, false);
    assert.equal(outputs.at(-1)?.mode, 'database');
    assert.equal(outputs.at(-1)?.checkedModules, 1);
    assert.deepEqual(
      outputs.at(-1)?.diagnostics.map((diagnostic) => diagnostic.code),
      ['MODULE_DATA_VERIFY_DB_DATABASE_URL_REQUIRED', 'MODULE_DATA_DB_APP_ROLE_SAFETY_SKIPPED']
    );
  } finally {
    process.exitCode = previousExitCode;
  }
});
