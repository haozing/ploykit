import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { defineModule } from '@ploykit/module-sdk';
import {
  createModuleDevConsoleSnapshot,
  normalizeModuleRuntimeContract,
  type ModuleMapArtifact,
} from '../src/lib/module-runtime';

const templateNames = [
  'basic',
  'dashboard',
  'product',
  'crud',
  'connector',
  'signed-service',
  'job',
  'product-app',
];
const extensionNames = ['service-backed', 'background'];
const hostBoundaryRuntimeDir = path.join('.runtime', 'test-modules', 'host-boundary-policy');

function writeModuleDataFixture(files: Record<string, string>): string {
  const fixtureRoot = path.join(
    'modules',
    `module-data-contract-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(fixtureRoot, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  }
  return fixtureRoot;
}

function writeHostBoundaryFixture(files: Record<string, string>): string {
  const fixtureRoot = path.join(
    hostBoundaryRuntimeDir,
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(fixtureRoot, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  }
  return fixtureRoot;
}

function runHostBoundaryCheck(cwd: string): childProcess.SpawnSyncReturns<string> {
  return childProcess.spawnSync(
    process.execPath,
    [path.join(process.cwd(), 'scripts', 'host-boundary-check.mjs')],
    {
      cwd,
      encoding: 'utf8',
    }
  );
}

test('module templates include contract, README, and smoke test', () => {
  for (const templateName of templateNames) {
    const templateRoot = path.join('templates', 'modules', templateName);
    assert.equal(fs.existsSync(path.join(templateRoot, 'module.ts')), true, templateName);
    assert.equal(fs.existsSync(path.join(templateRoot, 'README.md')), true, templateName);
    assert.equal(
      fs.existsSync(path.join(templateRoot, 'tests', 'smoke.test.ts')),
      true,
      templateName
    );
  }
});

test('module extensions are product-safe overlays with tests and no root README collision', () => {
  for (const extensionName of extensionNames) {
    const extensionRoot = path.join('templates', 'module-extensions', extensionName);
    assert.equal(fs.existsSync(extensionRoot), true, extensionName);
    assert.equal(fs.existsSync(path.join(extensionRoot, 'README.md')), false, extensionName);
    assert.equal(
      fs.existsSync(path.join(extensionRoot, 'tests', `${extensionName}.test.ts`)),
      true,
      extensionName
    );
  }
  assert.equal(
    fs.existsSync(path.join('templates', 'module-extensions', 'service-backed', 'tests', 'service-contract.json')),
    true
  );
});

test('module template CLI exposes product preset and extension overlays', () => {
  const result = childProcess.spawnSync(
    process.execPath,
    ['scripts/ploykit-module.mjs', 'templates'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const body = JSON.parse(result.stdout) as {
    templates: Array<{ name: string; files: string[] }>;
    extensions: Array<{ name: string; files: string[] }>;
  };

  assert.ok(body.templates.some((template) => template.name === 'product'));
  assert.ok(body.extensions.some((extension) => extension.name === 'service-backed'));
  assert.ok(body.extensions.some((extension) => extension.name === 'background'));
});

test('root tsconfig uses explicit path aliases without a wildcard catch-all', () => {
  const tsconfig = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8')) as {
    compilerOptions?: { paths?: Record<string, string[]> };
  };
  const paths = tsconfig.compilerOptions?.paths ?? {};

  assert.equal(Object.prototype.hasOwnProperty.call(paths, '*'), false);
  assert.deepEqual(paths['@ploykit/module-sdk'], ['src/module-sdk/index.ts']);
  assert.deepEqual(paths['@ploykit/module-sdk/*'], ['src/module-sdk/*']);
});

test('dev console snapshot summarizes module map, capabilities, and diagnostics', () => {
  const moduleDefinition = defineModule({
    id: 'console-test',
    name: 'Console Test',
    version: '0.1.0',
    routes: {
      dashboard: [
        {
          path: '/console-test',
          component: './pages/HomePage',
          auth: 'auth',
        },
      ],
    },
    actions: {
      ping: {
        handler: './actions/ping',
      },
    },
  });
  const contract = normalizeModuleRuntimeContract(moduleDefinition);
  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'console-test': {
        rootDir: 'modules/console-test',
        module: async () => ({ default: moduleDefinition }),
        pages: {
          'pages/HomePage': async () => ({ default: function HomePage() {} }),
        },
        actions: {
          'actions/ping': async () => ({ default: async () => ({ ok: true }) }),
        },
      },
    },
  };

  const snapshot = createModuleDevConsoleSnapshot({
    artifact,
    contracts: [contract],
    diagnosticsByModule: {
      'console-test': [
        {
          severity: 'warning',
          code: 'TEST_WARNING',
          message: 'Example warning',
        },
      ],
    },
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });

  assert.equal(snapshot.generatedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(snapshot.moduleCount, 1);
  assert.equal(snapshot.modules[0].status, 'warning');
  assert.equal(snapshot.modules[0].map.pages, 1);
  assert.equal(snapshot.modules[0].capabilities?.actions, 1);
});

test('module data CLI reads evaluated module.ts data contracts', (t) => {
  const fixtureRoot = writeModuleDataFixture({
    'data-contract.ts': `
      import type { ModuleDataDefinition } from '@ploykit/module-sdk';
      import { jsonb, table, text } from '@ploykit/module-sdk';

      export const data = {
        version: 1,
        tables: {
          notes: table({
            scope: 'workspace',
            columns: {
              title: text().notNull(),
              status: text().notNull().default('draft'),
              metadata: jsonb().notNull().default({ source: 'fixture' }),
            },
            indexes: [['status']],
          }),
        },
        views: {
          active_notes: {
            source: 'notes',
            fields: ['title', 'status'],
            where: { status: 'active' },
            scope: 'workspace',
          },
        },
        grants: {
          reader: {
            model: 'notes',
            operations: ['read'],
            roles: ['member'],
          },
        },
        checks: {
          notes_rls: {
            model: 'notes',
            kind: 'rls',
          },
        },
        migrations: {
          mode: 'generated',
          dir: './migrations',
        },
      } satisfies ModuleDataDefinition;
    `,
    'module.ts': `
      import { defineModule } from '@ploykit/module-sdk';
      import { data } from './data-contract';

      export default defineModule({
        id: 'imported-data-test',
        name: 'Imported Data Test',
        version: '0.1.0',
        data,
      });
    `,
  });
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const result = childProcess.spawnSync(
    process.execPath,
    ['scripts/module-data.mjs', 'plan', fixtureRoot],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const body = JSON.parse(result.stdout);
  const plan = body.modules[0];

  assert.equal(plan.moduleId, 'imported-data-test');
  assert.equal(plan.tables[0].name, 'notes');
  assert.equal(plan.tables[0].columns.status.default, 'draft');
  assert.equal(plan.views[0].definition.source, 'notes');
  assert.deepEqual(plan.grants[0].definition.operations, ['read']);
  assert.equal(plan.checks[0].definition.kind, 'rls');
});

test('host boundary check rejects tracked host policy and module map external source literals', (t) => {
  const fixtureRoot = writeHostBoundaryFixture({
    'package.json': JSON.stringify({ name: 'host-boundary-fixture', scripts: {} }, null, 2),
    'ploykit.config.json': JSON.stringify(
      {
        moduleSources: [{ id: 'workspace', path: 'modules' }],
      },
      null,
      2
    ),
    'src/lib/module-map.ts': [
      'export const MODULE_MAP = {',
      '  demo: { rootDir: "../some-product/modules/demo" }',
      '};',
      '',
    ].join('\n'),
    'src/lib/module-map.manifest.json': JSON.stringify(
      {
        version: 1,
        modules: [
          {
            id: 'demo',
            rootDir: '../some-product/modules/demo',
            sourceKind: 'external',
          },
        ],
      },
      null,
      2
    ),
    'apps/host-next/app/globals.css': [
      '@import "tailwindcss";',
      '@source "../../../../some-product/modules/specific-module";',
      '',
    ].join('\n'),
  });
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const result = runHostBoundaryCheck(fixtureRoot);
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0, output);
  assert.match(output, /host-policy-external-module-source-literal/);
  assert.match(output, /module-map-external-root/);
  assert.match(output, /module-map-external-source-kind/);
  assert.match(output, /apps\/host-next\/app\/globals\.css/);
});
