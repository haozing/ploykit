import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function writeExternalModule(): string {
  const moduleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ploykit-external-module-'));
  fs.writeFileSync(
    path.join(moduleRoot, 'module.ts'),
    `
      export default {
        id: 'external-map-fixture',
        name: 'External Map Fixture',
        version: '0.1.0',
      };
    `,
    'utf8'
  );
  return moduleRoot;
}

function runModuleMapCheck(env: Record<string, string | undefined>) {
  return childProcess.spawnSync(process.execPath, ['scripts/generate-module-map.mjs', '--check'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
  });
}

test('module map rejects external module dirs outside the allowlist', () => {
  const moduleRoot = writeExternalModule();
  const result = runModuleMapCheck({
    PLOYKIT_MODULE_DIRS: moduleRoot,
    PLOYKIT_MODULE_DIR_ALLOWLIST: '',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PLOYKIT_MODULE_DIR_ALLOWLIST/);
});

test('module map accepts allowlisted external module dirs before drift check', () => {
  const moduleRoot = writeExternalModule();
  const result = runModuleMapCheck({
    PLOYKIT_MODULE_DIRS: moduleRoot,
    PLOYKIT_MODULE_DIR_ALLOWLIST: path.dirname(moduleRoot),
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Module map check failed/);
  assert.doesNotMatch(result.stderr, /resolves outside the allowed module roots/);
});
