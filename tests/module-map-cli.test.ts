import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

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

function writeExternalModuleWithTests(): string {
  const moduleRoot = writeExternalModule();
  fs.mkdirSync(path.join(moduleRoot, 'tests'), { recursive: true });
  fs.writeFileSync(
    path.join(moduleRoot, 'tests', 'smoke.test.ts'),
    `
      import assert from 'node:assert/strict';
      import test from 'node:test';
      import moduleDefinition from '../module';

      test('external module fixture loads through sdk alias', () => {
        assert.equal(moduleDefinition.id, 'external-map-fixture');
      });
    `,
    'utf8'
  );
  return moduleRoot;
}

function writeExternalModuleWithMissingDependency(): string {
  const moduleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ploykit-external-module-'));
  fs.writeFileSync(
    path.join(moduleRoot, 'module.ts'),
    `
      import { defineModule } from '@ploykit/module-sdk';

      export default defineModule({
        id: 'external-missing-dependency',
        name: 'External Missing Dependency',
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
  return moduleRoot;
}

function writeConfig(moduleRoot: string, trustedRoots: string[], workspace = process.cwd()): string {
  const configFile = path.join(os.tmpdir(), `ploykit-config-${crypto.randomUUID()}.json`);
  fs.writeFileSync(
    configFile,
    `${JSON.stringify(
      {
        moduleSources: [
          { id: 'workspace', path: path.join(workspace, 'modules') },
          { id: 'external-fixtures', path: moduleRoot },
        ],
        trustedModuleRoots: trustedRoots,
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  return configFile;
}

function runModuleMapCheck(configFile: string) {
  return childProcess.spawnSync(process.execPath, ['scripts/generate-module-map.mjs', '--check'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PLOYKIT_CONFIG: configFile,
    },
  });
}

function runPloyKitCommand(configFile: string, args: string[]) {
  return childProcess.spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PLOYKIT_CONFIG: configFile,
    },
  });
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

test('module map rejects module sources outside trusted roots', () => {
  const moduleRoot = writeExternalModule();
  const result = runModuleMapCheck(writeConfig(moduleRoot, [process.cwd()]));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /trustedModuleRoots/);
});

test('module map accepts trusted external module sources before drift check', () => {
  const moduleRoot = writeExternalModule();
  const result = runModuleMapCheck(writeConfig(moduleRoot, [path.dirname(moduleRoot)]));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Module map check failed/);
  assert.doesNotMatch(result.stderr, /outside trusted module roots/);
});

test('module doctor and module test resolve trusted external modules by id', () => {
  withGeneratedModuleMapRestore(() => {
    const moduleRoot = writeExternalModuleWithTests();
    const configFile = writeConfig(moduleRoot, [process.cwd(), path.dirname(moduleRoot)]);

    const scan = runPloyKitCommand(configFile, ['scripts/generate-module-map.mjs']);
    assert.equal(scan.status, 0, scan.stderr);

    const doctor = runPloyKitCommand(configFile, [
      'scripts/ploykit-module.mjs',
      'doctor',
      'external-map-fixture',
    ]);
    assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
    assert.match(doctor.stdout, /"success": true/);
    assert.match(doctor.stdout, /"moduleRoot":/);

    const moduleTest = runPloyKitCommand(configFile, [
      'scripts/module-test.mjs',
      'external-map-fixture',
    ]);
    assert.equal(moduleTest.status, 0, moduleTest.stderr || moduleTest.stdout);
    assert.match(moduleTest.stdout, /"success": true/);
  });
});

test('module dependency check reports external npm dependencies missing from host manifest', () => {
  const moduleRoot = writeExternalModuleWithMissingDependency();
  const configFile = writeConfig(moduleRoot, [process.cwd(), path.dirname(moduleRoot)]);

  const result = runPloyKitCommand(configFile, ['scripts/module-deps.mjs', '--check']);
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
