import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { type TestContext } from 'node:test';

function writeExternalModule(): string {
  const moduleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ploykit-external-module-'));
  fs.writeFileSync(
    path.join(moduleRoot, 'module.ts'),
    `
      import { defineModule } from '@ploykit/module-sdk';

      export default defineModule({
        id: 'external-map-fixture',
        name: 'External Map Fixture',
        version: '0.1.0',
      });
    `,
    'utf8'
  );
  return moduleRoot;
}

function writeWorkspaceModuleWithMissingDependency(t: TestContext): string {
  const moduleId = `dependency-fixture-${crypto.randomUUID().slice(0, 8)}`;
  const moduleRoot = path.join(process.cwd(), 'modules', moduleId);
  fs.mkdirSync(moduleRoot, { recursive: true });
  fs.writeFileSync(
    path.join(moduleRoot, 'module.ts'),
    `
      import { defineModule } from '@ploykit/module-sdk';

      export default defineModule({
        id: '${moduleId}',
        name: 'Dependency Fixture',
        version: '0.1.0',
        dependencies: {
          npm: {
            'left-pad': '^1.3.0',
          },
        },
      });
    `,
    'utf8'
  );
  t.after(() => fs.rmSync(moduleRoot, { recursive: true, force: true }));
  return moduleRoot;
}

function writeWorkspaceModuleTestFixture(t: TestContext): { moduleId: string; moduleRoot: string } {
  const moduleId = `module-test-summary-${crypto.randomUUID().slice(0, 8)}`;
  const moduleRoot = path.join(process.cwd(), 'modules', moduleId);
  fs.mkdirSync(moduleRoot, { recursive: true });
  fs.writeFileSync(
    path.join(moduleRoot, 'module.ts'),
    `
      import { defineModule } from '@ploykit/module-sdk';

      export default defineModule({
        id: '${moduleId}',
        name: 'Module Test Summary Fixture',
        version: '0.1.0',
      });
    `,
    'utf8'
  );
  t.after(() => {
    fs.rmSync(moduleRoot, { recursive: true, force: true });
    fs.rmSync(path.join(process.cwd(), '.runtime', 'module-test-reports', `${moduleId}.json`), {
      force: true,
    });
  });
  return { moduleId, moduleRoot };
}

function writeWorkspaceModuleOutsideModules(t: TestContext): string {
  const moduleRoot = path.join(
    process.cwd(),
    '.runtime',
    `workspace-module-${crypto.randomUUID().slice(0, 8)}`
  );
  fs.mkdirSync(moduleRoot, { recursive: true });
  fs.writeFileSync(
    path.join(moduleRoot, 'module.ts'),
    `
      import { defineModule } from '@ploykit/module-sdk';

      export default defineModule({
        id: 'workspace-outside-modules',
        name: 'Workspace Outside Modules',
        version: '0.1.0',
      });
    `,
    'utf8'
  );
  t.after(() => fs.rmSync(moduleRoot, { recursive: true, force: true }));
  return moduleRoot;
}

function writeWorkspaceModuleWithNavigationIcon(t: TestContext): string {
  const moduleId = `icon-fixture-${crypto.randomUUID().slice(0, 8)}`;
  const moduleRoot = path.join(process.cwd(), 'modules', moduleId);
  fs.mkdirSync(moduleRoot, { recursive: true });
  fs.writeFileSync(
    path.join(moduleRoot, 'module.ts'),
    `
      import { defineModule } from '@ploykit/module-sdk';

      export default defineModule({
        id: '${moduleId}',
        name: 'Icon Fixture',
        version: '0.1.0',
        resources: {
          icons: {
            listChecks: { kind: 'lucide', name: 'ListChecks' },
          },
        },
        navigation: {
          location: 'dashboard.sidebar',
          fallbackLabel: 'Icon Fixture',
          path: '/icon-fixture',
          icon: 'listChecks',
        },
      });
    `,
    'utf8'
  );
  t.after(() => fs.rmSync(moduleRoot, { recursive: true, force: true }));
  return moduleId;
}

function runPloyKitCommand(args: string[]) {
  return childProcess.spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PLOYKIT_CONFIG: path.join(os.tmpdir(), `ignored-${crypto.randomUUID()}.json`),
    },
  });
}

function runModuleSourceImport(cwd: string) {
  const moduleSourcesUrl = pathToFileURL(
    path.join(process.cwd(), 'scripts', 'lib', 'module-sources.mjs')
  ).href;
  return childProcess.spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import(${JSON.stringify(moduleSourcesUrl)}).then((m) => { m.getModuleSources(process.cwd()); }).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });`,
    ],
    {
      cwd,
      encoding: 'utf8',
    }
  );
}

function withGeneratedModuleMapRestore<T>(run: () => T): T {
  const alwaysTrackedFiles = [
    path.join(process.cwd(), 'src', 'lib', 'module-map.ts'),
    path.join(process.cwd(), 'src', 'lib', 'module-map.manifest.json'),
  ];
  const files = new Set([...alwaysTrackedFiles, ...generatedModuleIconFiles()]);
  const originals = new Map(
    Array.from(files, (file) => [file, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null])
  );
  try {
    return run();
  } finally {
    for (const file of new Set([...generatedModuleIconFiles(), ...originals.keys()])) {
      const original = originals.get(file);
      if (original === undefined || original === null) {
        fs.rmSync(file, { force: true });
        continue;
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, original, 'utf8');
    }
  }
}

function generatedModuleIconFiles(): string[] {
  const registry = path.join(process.cwd(), 'src', 'lib', 'generated', 'module-icons.ts');
  const componentDir = path.join(process.cwd(), 'src', 'lib', 'generated', 'module-icons');
  const files = [registry];
  if (fs.existsSync(componentDir)) {
    for (const entry of fs.readdirSync(componentDir, { withFileTypes: true })) {
      if (entry.isFile()) {
        files.push(path.join(componentDir, entry.name));
      }
    }
  }
  return files;
}

test('module source discovery rejects configured sources outside the workspace', (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ploykit-source-config-'));
  const externalModule = writeExternalModule();
  t.after(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.rmSync(externalModule, { recursive: true, force: true });
  });

  fs.writeFileSync(
    path.join(fixtureRoot, 'ploykit.config.json'),
    `${JSON.stringify(
      {
        moduleSources: [{ id: 'external-fixtures', path: externalModule }],
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  const result = runModuleSourceImport(fixtureRoot);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /must live inside the PloyKit workspace/);
});

test('module source discovery rejects trustedModuleRoots configuration', (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ploykit-trusted-roots-'));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  fs.writeFileSync(
    path.join(fixtureRoot, 'ploykit.config.json'),
    `${JSON.stringify(
      {
        moduleSources: [{ id: 'workspace', path: 'modules' }],
        trustedModuleRoots: ['.'],
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  const result = runModuleSourceImport(fixtureRoot);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /must not declare trustedModuleRoots/);
});

test('module doctor rejects explicit external module roots', (t) => {
  const moduleRoot = writeExternalModule();
  t.after(() => fs.rmSync(moduleRoot, { recursive: true, force: true }));

  const result = runPloyKitCommand(['scripts/ploykit-module.mjs', 'doctor', moduleRoot]);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /must live inside the PloyKit workspace/);
});

test('module contract validation internal command rejects explicit external module roots', (t) => {
  const moduleRoot = writeExternalModule();
  t.after(() => fs.rmSync(moduleRoot, { recursive: true, force: true }));

  const result = runPloyKitCommand([
    'scripts/ploykit-module.mjs',
    'validate-contract-internal',
    moduleRoot,
  ]);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(`${result.stdout}\n${result.stderr}`, /must live inside the PloyKit workspace/);
});

test('module doctor rejects workspace module roots outside modules directory', (t) => {
  const moduleRoot = writeWorkspaceModuleOutsideModules(t);

  const result = runPloyKitCommand(['scripts/ploykit-module.mjs', 'doctor', moduleRoot]);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /must live under modules\/<id>/);
});

test('module dependency check reports workspace npm dependencies missing from host manifest', (t) => {
  writeWorkspaceModuleWithMissingDependency(t);

  const result = runPloyKitCommand(['scripts/module-deps.mjs', '--check']);
  assert.equal(result.status, 1, result.stderr || result.stdout);

  const body = JSON.parse(result.stdout) as {
    success: boolean;
    missing: { name: string; range: string }[];
  };
  assert.equal(body.success, false);
  assert.ok(
    body.missing.some(
      (dependency) => dependency.name === 'left-pad' && dependency.range === '^1.3.0'
    )
  );
});

test('generated module map manifest omits external source metadata', () => {
  withGeneratedModuleMapRestore(() => {
    const scan = runPloyKitCommand(['scripts/generate-module-map.mjs']);
    assert.equal(scan.status, 0, scan.stderr || scan.stdout);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'module-map.manifest.json'), 'utf8')
    ) as {
      trustedModuleRoots?: unknown;
      moduleSources?: unknown;
      config?: unknown;
      modules: Array<Record<string, unknown>>;
    };

    assert.equal('trustedModuleRoots' in manifest, false);
    assert.equal('moduleSources' in manifest, false);
    assert.equal('config' in manifest, false);
    assert.equal(
      manifest.modules.some(
        (moduleInfo) =>
          'sourceId' in moduleInfo || 'sourceDir' in moduleInfo || 'sourceKind' in moduleInfo
      ),
      false
    );
  });
});

test('module map check reports drifted module digests with a fix command', () => {
  withGeneratedModuleMapRestore(() => {
    const scan = runPloyKitCommand(['scripts/generate-module-map.mjs']);
    assert.equal(scan.status, 0, scan.stderr || scan.stdout);

    const manifestFile = path.join(process.cwd(), 'src', 'lib', 'module-map.manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as {
      modules: Array<{
        id: string;
        release?: {
          sourceHash?: string;
        };
      }>;
    };
    assert.ok(manifest.modules.length > 0);

    const driftedModule = manifest.modules[0];
    driftedModule.release ??= {};
    driftedModule.release.sourceHash =
      '0000000000000000000000000000000000000000000000000000000000000000';
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const result = runPloyKitCommand(['scripts/generate-module-map.mjs', '--check']);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /Drift summary:/);
    assert.match(
      result.stderr,
      new RegExp(`${driftedModule.id}: .*sourceHash 000000000000 -> [a-f0-9]{12}`)
    );
    assert.match(result.stderr, /Fix command: npm run modules:scan/);
  });
});

test('generated module icon registry includes host core and declared module navigation icons', (t) => {
  withGeneratedModuleMapRestore(() => {
    const moduleId = writeWorkspaceModuleWithNavigationIcon(t);
    const scan = runPloyKitCommand(['scripts/generate-module-map.mjs']);
    assert.equal(scan.status, 0, scan.stderr || scan.stdout);

    const registry = fs.readFileSync(
      path.join(process.cwd(), 'src', 'lib', 'generated', 'module-icons.ts'),
      'utf8'
    );
    assert.match(registry, /export const HOST_CORE_ICON_FALLBACK = "activity"/);
    assert.match(registry, /"layoutDashboard": LayoutDashboard/);
    assert.match(registry, new RegExp(`"${moduleId}:listChecks": ListChecks`));
    assert.doesNotMatch(registry, /"listChecks": ListChecks/);
  });
});

test('module test summary keeps stdout short while writing the detailed report', (t) => {
  const { moduleId, moduleRoot } = writeWorkspaceModuleTestFixture(t);
  const result = runPloyKitCommand(['scripts/module-test.mjs', moduleRoot, '--summary']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Module test summary:/);
  assert.match(result.stdout, new RegExp(`${moduleId}: passed`));
  assert.match(
    result.stdout,
    /\.runtime\/module-test-reports\/module-test-summary-[a-f0-9-]+\.json/
  );
  assert.doesNotMatch(result.stdout, /"steps":/);

  const reportFile = path.join(
    process.cwd(),
    '.runtime',
    'module-test-reports',
    `${moduleId}.json`
  );
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8')) as {
    success: boolean;
    moduleId: string;
    steps: Array<{ name: string; stdout: string }>;
  };

  assert.equal(report.success, true);
  assert.equal(report.moduleId, moduleId);
  assert.ok(report.steps.some((step) => step.name === 'doctor' && typeof step.stdout === 'string'));
});

test('module test help documents output modes, report files, and exit codes', () => {
  const result = runPloyKitCommand(['scripts/module-test.mjs', '--help']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /--summary\s+Print a compact human-readable summary/);
  assert.match(result.stdout, /--json\s+Print the full JSON report/);
  assert.match(result.stdout, /\.runtime\/module-test-reports\/<module-id>\.json/);
  assert.match(
    result.stdout,
    /0 when every executed step passes, including warning-only doctor diagnostics/
  );
  assert.match(
    result.stdout,
    /1 when target resolution fails or any doctor, fake-host, or real-host step fails/
  );
});
