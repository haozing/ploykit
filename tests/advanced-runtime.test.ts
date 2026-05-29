import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  defineModule } from '@ploykit/module-sdk';
import {
  createModuleBundleManifest,
  createModuleCapabilityMeter,
  normalizeModuleRuntimeContract,
  type ModuleMapArtifact,
} from '../src/lib/module-runtime';
import {
  createInMemoryModuleCommercialRuntime,
  createInMemoryModuleRagRuntime,
  createStaticModuleAiRuntime,
} from '../src/lib/module-capabilities';

const dataDiffRuntimeDir = path.join('.runtime', 'test-modules', 'data-diff');

function writeDataDiffFixture(files: Record<string, string>): string {
  const fixtureRoot = path.join(
    dataDiffRuntimeDir,
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(fixtureRoot, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  }
  return fixtureRoot;
}

test('data diff reports no changes against generated hello baseline', () => {
  const result = childProcess.spawnSync(
    process.execPath,
    ['scripts/module-data-diff.mjs', 'modules/hello'],
    {
      encoding: 'utf8',
    }
  );
  const body = JSON.parse(result.stdout) as { success: boolean; modules: { changes: unknown[] }[] };

  assert.equal(result.status, 0);
  assert.equal(body.success, true);
  assert.equal(body.modules[0].changes.length, 0);
});

test('data diff reports index drift beyond field shape changes', (t) => {
  const fixtureRoot = writeDataDiffFixture({
    'module.ts': `
      import { defineModule, table, text } from '@ploykit/module-sdk';

      export default defineModule({
        id: 'data-diff-index-test',
        name: 'Data Diff Index Test',
        version: '0.1.0',
        data: {
          version: 1,
          tables: {
            notes: table({
              scope: 'workspace',
              columns: {
                title: text().notNull(),
                status: text().notNull(),
              },
              indexes: [['status']],
            }),
          },
          migrations: {
            mode: 'generated',
            dir: './migrations',
          },
        },
      });
    `,
    '.ploykit/generated/data-plan.json': `${JSON.stringify(
      {
        version: 1,
        moduleId: 'data-diff-index-test',
        moduleRoot: '',
        dataVersion: 1,
        documents: [],
        tables: [
          {
            name: 'notes',
            physicalName: 'mod_data_diff_index_test__notes',
            scope: 'workspace',
            columns: {
              title: {
                kind: 'text',
                nullable: false,
                primaryKey: false,
                defaultRandom: false,
              },
              status: {
                kind: 'text',
                nullable: false,
                primaryKey: false,
                defaultRandom: false,
              },
            },
            unique: [],
            indexes: [],
          },
        ],
        views: [],
        grants: [],
        checks: [],
        migrations: {
          mode: 'generated',
          dir: './migrations',
        },
        schemaHash: 'baseline',
      },
      null,
      2
    )}\n`,
  });
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const result = childProcess.spawnSync(
    process.execPath,
    ['scripts/module-data-diff.mjs', fixtureRoot],
    {
      encoding: 'utf8',
    }
  );
  const body = JSON.parse(result.stdout) as {
    success: boolean;
    modules: { changes: { path: string; kind: string }[] }[];
  };

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(body.success, true);
  assert.ok(
    body.modules[0].changes.some(
      (change) => change.path === 'tables.notes.indexes.status' && change.kind === 'additive'
    )
  );
});

test('data migrate dry-run rejects stale generated migration artifacts', (t) => {
  const fixtureRoot = writeDataDiffFixture({
    'module.ts': `
      import { defineModule, table, text } from '@ploykit/module-sdk';

      export default defineModule({
        id: 'data-migrate-stale-test',
        name: 'Data Migrate Stale Test',
        version: '0.1.0',
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
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const generated = childProcess.spawnSync(
    process.execPath,
    ['scripts/module-data.mjs', 'generate', fixtureRoot],
    {
      encoding: 'utf8',
    }
  );
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);

  fs.writeFileSync(path.join(fixtureRoot, 'migrations', '0001_generated.sql'), 'select 1;\n', 'utf8');
  const result = childProcess.spawnSync(
    process.execPath,
    ['scripts/module-data.mjs', 'migrate', fixtureRoot, '--dry-run'],
    {
      encoding: 'utf8',
    }
  );
  const body = JSON.parse(result.stdout) as {
    success: boolean;
    diagnostics: { code: string }[];
  };

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(body.success, false);
  assert.ok(body.diagnostics.some((diagnostic) => diagnostic.code === 'MODULE_DATA_MIGRATION_STALE'));
});

test('module bundle manifest can select enabled modules for production builds', () => {
  const moduleDefinition = defineModule({
    id: 'bundle-test',
    name: 'Bundle Test',
    version: '0.1.0',
    jobs: {
      sync: {
        handler: './jobs/sync',
      },
    },
  });
  const contract = normalizeModuleRuntimeContract(moduleDefinition);
  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'bundle-test': {
        rootDir: 'modules/bundle-test',
        module: async () => ({ default: moduleDefinition }),
        jobs: {
          'jobs/sync': async () => ({ default: async () => ({ ok: true }) }),
        },
      },
      disabled: {
        rootDir: 'modules/disabled',
        module: async () => ({
          default: defineModule({ id: 'disabled', name: 'Disabled', version: '0.1.0' }),
        }),
      },
    },
  };

  const manifest = createModuleBundleManifest({
    artifact,
    contracts: [contract],
    enabledModules: ['bundle-test'],
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });

  assert.equal(manifest.generatedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(manifest.modules.length, 1);
  assert.equal(manifest.modules[0].files.jobs.length, 1);
  assert.equal(manifest.modules[0].capabilities?.jobs, 1);
});

test('AI and capability metering record usage while RAG stays module isolated', async () => {
  const commercial = createInMemoryModuleCommercialRuntime();
  const ai = createStaticModuleAiRuntime({
    usage: (moduleId) => commercial.forModule(moduleId).usage,
    responsePrefix: 'ok: ',
  });
  const rag = createInMemoryModuleRagRuntime();
  const moduleA = rag.forModule('module-a');
  const moduleB = rag.forModule('module-b');
  const capabilityMeter = createModuleCapabilityMeter(commercial.forModule('module-a').usage);

  await moduleA.index({ id: 'a1', content: 'alpha product notes' });
  await moduleB.index({ id: 'b1', content: 'beta product notes' });
  const text = await ai.forModule('module-a').generateText({
    prompt: 'summarize alpha',
    idempotencyKey: 'ai_1',
  });
  const embedding = await ai.forModule('module-a').embedText({ text: 'alpha' });
  await capabilityMeter.record({ kind: 'job.run', idempotencyKey: 'job_1' });

  assert.equal(text.text, 'ok: summarize alpha');
  assert.equal(embedding.embedding.length, 3);
  assert.equal((await moduleA.search({ query: 'alpha' })).length, 1);
  assert.equal((await moduleB.search({ query: 'alpha' })).length, 0);
  assert.equal(commercial.listUsage().length, 3);
});
