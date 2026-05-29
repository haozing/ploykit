import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readModuleIdFromSource, resolveModuleRoot, slash } from './lib/module-sources.mjs';

const PROJECT_ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const SDK_ALIAS_REGISTER = path.join(PROJECT_ROOT, 'scripts', 'lib', 'module-sdk-alias.cjs');

function toProjectPath(file) {
  return slash(path.relative(PROJECT_ROOT, file));
}

function discoverTestFiles(moduleRoot) {
  const testsDir = path.join(moduleRoot, 'tests');
  const files = [];
  if (!fs.existsSync(testsDir)) {
    return files;
  }

  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (
        entry.isFile() &&
        SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
        entry.name.includes('.test.')
      ) {
        files.push(fullPath);
      }
    }
  }

  visit(testsDir);
  return files.sort();
}

function run(command, args) {
  const executable =
    process.platform === 'win32' && (command === 'npm' || command === 'npx')
      ? `${command}.cmd`
      : command;
  const result = childProcess.spawnSync(executable, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  });

  return {
    command: [command, ...args].join(' '),
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? result.error?.message ?? '').trim(),
  };
}

function runTsxTest(testFiles) {
  const localTsxCli = path.join(PROJECT_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (fs.existsSync(localTsxCli)) {
    return run(process.execPath, [
      localTsxCli,
      '--tsconfig',
      path.join(PROJECT_ROOT, 'tsconfig.json'),
      '--require',
      SDK_ALIAS_REGISTER,
      '--test',
      ...testFiles.map(toProjectPath),
    ]);
  }
  return run('npx', [
    'tsx',
    '--tsconfig',
    path.join(PROJECT_ROOT, 'tsconfig.json'),
    '--require',
    SDK_ALIAS_REGISTER,
    '--test',
    ...testFiles.map(toProjectPath),
  ]);
}

function parseArgs(args) {
  let target = '';
  let real = false;

  for (const arg of args) {
    if (arg === '--real') {
      real = true;
      continue;
    }
    target = arg;
  }

  return { target, real };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function reportFileFor(moduleRoot) {
  const moduleId = readModuleIdFromSource(moduleRoot);
  return path.join(PROJECT_ROOT, '.runtime', 'module-test-reports', `${moduleId}.json`);
}

function saveReport(moduleRoot, report) {
  const reportFile = reportFileFor(moduleRoot);
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  return toProjectPath(reportFile);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  let moduleRoot;
  try {
    moduleRoot = resolveModuleRoot(PROJECT_ROOT, options.target);
  } catch (error) {
    printJson({
      success: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'MODULE_TEST_TARGET_INVALID',
          message: error instanceof Error ? error.message : String(error),
          path: options.target,
          fix: 'Pass a module id or module root path from ploykit.config.json.',
        },
      ],
    });
    process.exitCode = 1;
    return;
  }
  const steps = [];

  if (!fs.existsSync(path.join(moduleRoot, 'module.ts'))) {
    printJson({
      success: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'MODULE_TEST_TARGET_INVALID',
          message: `Target "${options.target}" is not a module root.`,
          path: options.target,
          fix: 'Pass a module id or module root path from ploykit.config.json.',
        },
      ],
    });
    process.exitCode = 1;
    return;
  }

  const doctor = run(process.execPath, [
    path.join('scripts', 'ploykit-module.mjs'),
    'doctor',
    moduleRoot,
  ]);
  steps.push({ name: 'doctor', ...doctor });

  const testFiles = discoverTestFiles(moduleRoot);
  if (testFiles.length > 0) {
    const fakeHost = runTsxTest(testFiles);
    steps.push({
      name: 'fake-host',
      files: testFiles.map(toProjectPath),
      ...fakeHost,
    });
  } else {
    steps.push({
      name: 'fake-host',
      ok: true,
      status: 0,
      command: 'no module tests found',
      stdout: '',
      stderr: '',
      files: [],
    });
  }

  if (options.real) {
    steps.push({
      name: 'real-host',
      ...run('npm', ['run', 'test:host-runtime']),
    });
  }

  const success = steps.every((step) => step.ok);
  const report = {
    success,
    moduleRoot: toProjectPath(moduleRoot),
    mode: options.real ? 'real' : 'fake',
    steps,
    checkedAt: new Date().toISOString(),
  };
  report.reportFile = saveReport(moduleRoot, report);
  printJson(report);
  if (!success) {
    process.exitCode = 1;
  }
}

main();
