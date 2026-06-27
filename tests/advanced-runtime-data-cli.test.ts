import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { writeDataDiffFixture } from './advanced-runtime-data-helpers';

test('data diff reports no changes against generated resource-smoke baseline', () => {
  const result = childProcess.spawnSync(
    process.execPath,
    ['scripts/module-data-diff.mjs', 'modules/resource-smoke'],
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

  fs.writeFileSync(
    path.join(fixtureRoot, 'migrations', '0001_generated.sql'),
    'select 1;\n',
    'utf8'
  );
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
  assert.ok(
    body.diagnostics.some((diagnostic) => diagnostic.code === 'MODULE_DATA_MIGRATION_STALE')
  );
});

test('data CLI derives Data v2 artifacts from clean-slate resources', (t) => {
  const fixtureRoot = writeDataDiffFixture({
    'module.ts': `
      import {
        defineModule,
        resource,
        schema,
        stringField,
        textField,
      } from '@ploykit/module-sdk';

      const noteSchema = schema({
        name: 'Note',
        fields: {
          title: stringField({ required: true, maxLength: 120 }),
          body: textField(),
        },
      });

      export default defineModule({
        id: 'clean-resource-data-test',
        name: 'Clean Resource Data Test',
        version: '0.1.0',
        assets: {},
        resources: {
          notes: resource({
            scope: 'workspace',
            schema: noteSchema,
            storage: { table: 'notes' },
          }),
        },
        pages: [
          {
            id: 'notes.list',
            area: 'dashboard',
            path: '/notes',
            frame: 'workspace',
            component: './pages/NotesListPage.tsx',
          },
        ],
      });
    `,
    'pages/NotesListPage.tsx': `
      export default function NotesListPage() {
        return null;
      }
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

  const types = childProcess.spawnSync(
    process.execPath,
    ['scripts/module-data.mjs', 'types', fixtureRoot],
    {
      encoding: 'utf8',
    }
  );
  assert.equal(types.status, 0, types.stderr || types.stdout);

  const dataPlan = JSON.parse(
    fs.readFileSync(path.join(fixtureRoot, '.ploykit', 'generated', 'data-plan.json'), 'utf8')
  ) as {
    tables: Array<{ name: string; columns: Record<string, { kind: string; nullable: boolean }> }>;
    resourceFacts: Array<{ name: string; kind: string; model: string; schema: { fixture: unknown } }>;
  };
  assert.equal(dataPlan.tables[0]?.name, 'notes');
  assert.equal(dataPlan.tables[0]?.columns.title.kind, 'text');
  assert.equal(dataPlan.tables[0]?.columns.title.nullable, false);
  assert.equal(dataPlan.resourceFacts[0]?.name, 'notes');
  assert.equal(dataPlan.resourceFacts[0]?.kind, 'table');
  assert.equal(dataPlan.resourceFacts[0]?.model, 'notes');

  const generatedTypes = fs.readFileSync(
    path.join(fixtureRoot, '.ploykit', 'generated', 'data-types.ts'),
    'utf8'
  );
  assert.match(generatedTypes, /export type NotesResource = NotesTable;/);
  assert.match(generatedTypes, /export const notesFixture: NotesResource/);
});
