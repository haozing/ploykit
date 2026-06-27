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

const templateNames = ['app', 'connector', 'resource', 'tool'];
const dataArtifactTemplates = new Set(['resource']);
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

function runProjectNodeScript(args: string[]): childProcess.SpawnSyncReturns<string> {
  return childProcess.spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

function templateChoiceList(): string {
  return templateNames.join('|');
}

function copyTemplateFixture(
  templateRoot: string,
  moduleRoot: string,
  variables: { moduleId: string; moduleName: string }
): void {
  fs.mkdirSync(moduleRoot, { recursive: true });
  for (const entry of fs.readdirSync(templateRoot, { withFileTypes: true })) {
    const source = path.join(templateRoot, entry.name);
    const target = path.join(moduleRoot, entry.name);
    if (entry.isDirectory()) {
      copyTemplateFixture(source, target, variables);
      continue;
    }
    if (entry.isFile()) {
      const content = fs
        .readFileSync(source, 'utf8')
        .replaceAll('__MODULE_ID__', variables.moduleId)
        .replaceAll('__MODULE_NAME__', variables.moduleName);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, 'utf8');
    }
  }
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

test('module template CLI exposes clean ordinary templates', () => {
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
  const cliTemplateNames = body.templates.map((template) => template.name).sort();

  assert.deepEqual(cliTemplateNames, templateNames);
  assert.deepEqual(cliTemplateNames, ['app', 'connector', 'resource', 'tool']);
  assert.deepEqual(body.extensions, []);
});

test('module CLI help documents dynamic template and extension choices', () => {
  const rootHelp = runProjectNodeScript(['scripts/ploykit-module.mjs', '--help']);
  const createHelp = runProjectNodeScript(['scripts/ploykit-module.mjs', 'create', '--help']);
  const expectedCreateUsage = `--template ${templateChoiceList()}`;

  assert.equal(rootHelp.status, 0, rootHelp.stderr || rootHelp.stdout);
  assert.equal(createHelp.status, 0, createHelp.stderr || createHelp.stdout);
  assert.match(rootHelp.stdout, /doctor <module-id\|module-root\|all>/);
  assert.match(rootHelp.stdout, /templates\s+Print available module templates/);
  assert.ok(rootHelp.stdout.includes(expectedCreateUsage), rootHelp.stdout);
  assert.ok(createHelp.stdout.includes(expectedCreateUsage), createHelp.stdout);
  assert.equal(createHelp.stdout.includes('--with'), false, createHelp.stdout);
});

test('module create rejects non-core template extensions', () => {
  const result = runProjectNodeScript([
    'scripts/ploykit-module.mjs',
    'create',
    `template-with-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    '--with',
    'background',
  ]);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stdout, /Module extensions are not part of the clean ordinary template path/);
});

test('module templates generate modules that pass doctor and fake-host tests', (t) => {
  const createdModuleIds: string[] = [];
  t.after(() => {
    for (const moduleId of createdModuleIds) {
      fs.rmSync(path.join(process.cwd(), 'modules', moduleId), { recursive: true, force: true });
      fs.rmSync(path.join(process.cwd(), '.runtime', 'module-test-reports', `${moduleId}.json`), {
        force: true,
      });
    }
  });

  for (const templateName of templateNames) {
    const moduleId = `template-${templateName}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const moduleRoot = path.join(process.cwd(), 'modules', moduleId);
    createdModuleIds.push(moduleId);
    copyTemplateFixture(path.join('templates', 'modules', templateName), moduleRoot, {
      moduleId,
      moduleName: `Template ${templateName}`,
    });

    if (dataArtifactTemplates.has(templateName)) {
      const generate = runProjectNodeScript(['scripts/module-data.mjs', 'generate', moduleRoot]);
      assert.equal(generate.status, 0, `${templateName}\n${generate.stdout}\n${generate.stderr}`);
      const types = runProjectNodeScript(['scripts/module-data.mjs', 'types', moduleRoot]);
      assert.equal(types.status, 0, `${templateName}\n${types.stdout}\n${types.stderr}`);
    }

    const doctor = runProjectNodeScript(['scripts/ploykit-module.mjs', 'doctor', moduleRoot]);
    assert.equal(doctor.status, 0, `${templateName}\n${doctor.stdout}\n${doctor.stderr}`);

    const moduleTest = runProjectNodeScript(['scripts/module-test.mjs', moduleRoot, '--summary']);
    assert.equal(
      moduleTest.status,
      0,
      `${templateName}\n${moduleTest.stdout}\n${moduleTest.stderr}`
    );
    assert.match(moduleTest.stdout, new RegExp(`${moduleId}: passed`));
  }
});

test('module create defaults to the clean app template', (t) => {
  const moduleId = `template-default-app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const moduleRoot = path.join(process.cwd(), 'modules', moduleId);
  t.after(() => {
    fs.rmSync(moduleRoot, { recursive: true, force: true });
    fs.rmSync(path.join(process.cwd(), '.runtime', 'module-test-reports', `${moduleId}.json`), {
      force: true,
    });
    runProjectNodeScript(['scripts/generate-module-map.mjs']);
  });

  const create = runProjectNodeScript(['scripts/ploykit-module.mjs', 'create', moduleId]);
  assert.equal(create.status, 0, create.stderr || create.stdout);
  const body = JSON.parse(create.stdout) as { template: string; next: string[] };
  assert.equal(body.template, 'app');
  assert.ok(body.next.some((item) => item.includes(`/dashboard/${moduleId}`)));
  const moduleSource = fs.readFileSync(path.join(moduleRoot, 'module.ts'), 'utf8');
  assert.equal(moduleSource.includes('contractVersion'), false);
  assert.equal(moduleSource.includes('pages'), true);
  assert.equal(moduleSource.includes('product'), false);
});

test('module dev reports host preview URLs after checks', (t) => {
  const moduleId = `dev-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const moduleRoot = path.join(process.cwd(), 'modules', moduleId);
  t.after(() => {
    fs.rmSync(moduleRoot, { recursive: true, force: true });
    runProjectNodeScript(['scripts/generate-module-map.mjs']);
  });

  const create = runProjectNodeScript(['scripts/ploykit-module.mjs', 'create', moduleId]);
  assert.equal(create.status, 0, create.stderr || create.stdout);

  const dev = runProjectNodeScript(['scripts/ploykit-module.mjs', 'dev', moduleRoot]);
  assert.equal(dev.status, 0, dev.stderr || dev.stdout);
  const body = JSON.parse(dev.stdout) as {
    start: string;
    previews: Array<{ moduleId: string; url: string }>;
    next: string[];
  };

  assert.equal(body.start, 'npm run host:dev');
  assert.equal(body.previews[0]?.moduleId, moduleId);
  assert.equal(body.previews[0]?.url, `http://localhost:3000/dashboard/${moduleId}`);
  assert.ok(body.next.includes('npm run host:dev'));
});

test('module test rejects clean-slate pages that return object fallback', (t) => {
  const moduleId = `object-page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const moduleRoot = path.join(process.cwd(), 'modules', moduleId);
  t.after(() => {
    fs.rmSync(moduleRoot, { recursive: true, force: true });
    fs.rmSync(path.join(process.cwd(), '.runtime', 'module-test-reports', `${moduleId}.json`), {
      force: true,
    });
  });

  fs.mkdirSync(path.join(moduleRoot, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(moduleRoot, 'tests'), { recursive: true });
  fs.writeFileSync(
    path.join(moduleRoot, 'module.ts'),
    `
      import { defineModule, page } from '@ploykit/module-sdk';

      export default defineModule({
        id: '${moduleId}',
        name: 'Object Page',
        version: '0.1.0',
        pages: [
          page({
            id: '${moduleId}.home',
            area: 'dashboard',
            path: '/${moduleId}',
            frame: 'workspace',
            component: './pages/HomePage.tsx',
            auth: 'auth',
          }),
        ],
      });
    `,
    'utf8'
  );
  fs.writeFileSync(
    path.join(moduleRoot, 'pages', 'HomePage.tsx'),
    `
      export default function HomePage() {
        return { view: 'legacy-object' };
      }
    `,
    'utf8'
  );
  fs.writeFileSync(
    path.join(moduleRoot, 'tests', 'smoke.test.ts'),
    `
      import test from 'node:test';
      import assert from 'node:assert/strict';
      import moduleDefinition from '../module';

      test('module exports contract', () => {
        assert.equal(moduleDefinition.id, '${moduleId}');
      });
    `,
    'utf8'
  );

  const moduleTest = runProjectNodeScript(['scripts/module-test.mjs', moduleRoot, '--summary']);
  assert.notEqual(moduleTest.status, 0, moduleTest.stdout);
  assert.match(moduleTest.stdout, /page-render-smoke failed/);
  assert.match(moduleTest.stdout, /pages\.0\.renderOutput/);
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
    assets: {},
    pages: [
      {
        id: 'console-test.home',
        area: 'dashboard',
        path: '/console-test',
        frame: 'workspace',
        component: './pages/HomePage',
        auth: 'auth',
      },
    ],
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

test('host boundary check rejects concrete module dashboard routes in host code', (t) => {
  const fixtureRoot = writeHostBoundaryFixture({
    'package.json': JSON.stringify({ name: 'host-boundary-fixture', scripts: {} }, null, 2),
    'src/lib/module-map.ts': 'export {};\n',
    'src/lib/module-map.manifest.json': JSON.stringify(
      {
        version: 1,
        modules: [
          {
            id: 'sample-module',
            rootDir: 'modules/sample-module',
          },
        ],
      },
      null,
      2
    ),
    'apps/host-next/components/layout/Sidebar.tsx': [
      'export const canonicalDashboardPaths = {',
      '  "/dashboard/sample-module/legacy": "/dashboard/sample-module/current",',
      '};',
      '',
    ].join('\n'),
  });
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const result = runHostBoundaryCheck(fixtureRoot);
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0, output);
  assert.match(output, /concrete-module-literal/);
  assert.match(output, /apps\/host-next\/components\/layout\/Sidebar\.tsx/);
  assert.match(output, /sample-module/);
});
