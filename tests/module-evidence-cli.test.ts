import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function writeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ploykit-module-evidence-'));
  const moduleRoot = path.join(root, 'modules', 'evidence-fixture');
  fs.mkdirSync(path.join(moduleRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    `${JSON.stringify(
      {
        version: 1,
        modules: [
          {
            id: 'evidence-fixture',
            name: 'Evidence Fixture',
            rootDir: path.relative(process.cwd(), moduleRoot),
          },
        ],
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(moduleRoot, 'scripts', 'probe.mjs'),
    `
      import fs from 'node:fs';

      const outIndex = process.argv.indexOf('--out');
      const out = process.argv[outIndex + 1];
      fs.writeFileSync(out, JSON.stringify({
        argv: process.argv.slice(2),
        cwd: process.cwd(),
        projectRoot: process.env.PLOYKIT_PROJECT_ROOT,
        moduleId: process.env.PLOYKIT_MODULE_ID,
        moduleRoot: process.env.PLOYKIT_MODULE_ROOT,
        evidenceId: process.env.PLOYKIT_MODULE_EVIDENCE_ID,
        outputDir: process.env.PLOYKIT_MODULE_EVIDENCE_OUTPUT_DIR
      }, null, 2));
      console.log('probe complete');
    `,
    'utf8'
  );
  return { root, moduleRoot, manifest: path.join(root, 'manifest.json') };
}

function runEvidence(args: string[]) {
  return childProcess.spawnSync(process.execPath, ['scripts/module-evidence.mjs', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

test('module evidence runner executes a module-local script with forwarded args', (t) => {
  const fixture = writeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const output = path.join(fixture.root, 'probe-output.json');

  const result = runEvidence([
    '--manifest',
    fixture.manifest,
    '--module',
    'evidence-fixture',
    '--file',
    './scripts/probe.mjs',
    '--id',
    'probe',
    '--cwd',
    'module',
    '--',
    '--out',
    output,
    '--flag',
    'ok',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  const probe = JSON.parse(fs.readFileSync(output, 'utf8'));

  assert.equal(report.ok, true);
  assert.equal(report.moduleId, 'evidence-fixture');
  assert.equal(report.evidenceId, 'probe');
  assert.equal(probe.cwd, fs.realpathSync(fixture.moduleRoot));
  assert.equal(probe.moduleId, 'evidence-fixture');
  assert.equal(probe.evidenceId, 'probe');
  assert.deepEqual(probe.argv.slice(-2), ['--flag', 'ok']);
  assert.equal(fs.existsSync(report.artifacts.stdoutLog), true);
  assert.match(fs.readFileSync(report.artifacts.stdoutLog, 'utf8'), /probe complete/);
});

test('module evidence runner rejects scripts outside the module root', (t) => {
  const fixture = writeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const outside = path.join(fixture.root, 'outside.mjs');
  fs.writeFileSync(outside, 'console.log("outside");\n', 'utf8');

  const result = runEvidence([
    '--manifest',
    fixture.manifest,
    '--module',
    'evidence-fixture',
    '--file',
    path.relative(fixture.moduleRoot, outside),
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must stay inside module root/);
});
