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

function writeWorkspaceModuleOutsideModules(t: TestContext): string {
  const moduleRoot = path.join(process.cwd(), '.runtime', `workspace-module-${crypto.randomUUID().slice(0, 8)}`);
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
  const files = [
    path.join(process.cwd(), 'src', 'lib', 'module-map.ts'),
    path.join(process.cwd(), 'src', 'lib', 'module-map.manifest.json'),
  ];
  const originals = files.map((file) => fs.readFileSync(file, 'utf8'));
  try {
    return run();
  } finally {
    for (const [index, file] of files.entries()) {
      fs.writeFileSync(file, originals[index], 'utf8');
    }
  }
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

  const result = runPloyKitCommand(['scripts/ploykit-module.mjs', 'validate-contract-internal', moduleRoot]);
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
    body.missing.some((dependency) => dependency.name === 'left-pad' && dependency.range === '^1.3.0')
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
