import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  discoverModuleRoots,
  readModuleIdFromSource,
  resolveModuleRoot,
  slash,
} from './lib/module-sources.mjs';

const PROJECT_ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const SDK_ALIAS_REGISTER = path.join(PROJECT_ROOT, 'scripts', 'lib', 'module-sdk-alias.cjs');
const TSX_TSCONFIG = path.join(PROJECT_ROOT, 'tsconfig.json');

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
      TSX_TSCONFIG,
      '--require',
      SDK_ALIAS_REGISTER,
      '--test',
      ...testFiles.map(toProjectPath),
    ]);
  }
  return run('npx', [
    'tsx',
    '--tsconfig',
    TSX_TSCONFIG,
    '--require',
    SDK_ALIAS_REGISTER,
    '--test',
    ...testFiles.map(toProjectPath),
  ]);
}

function parseArgs(args) {
  let target = '';
  let real = false;
  let output = 'json';
  let help = false;

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--real') {
      real = true;
      continue;
    }
    if (arg === '--summary') {
      output = 'summary';
      continue;
    }
    if (arg === '--json') {
      output = 'json';
      continue;
    }
    target = arg;
  }

  return { target, real, output, help };
}

function runTsxEval(script) {
  const localTsxCli = path.join(PROJECT_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (fs.existsSync(localTsxCli)) {
    return run(process.execPath, [
      localTsxCli,
      '--tsconfig',
      TSX_TSCONFIG,
      '--require',
      SDK_ALIAS_REGISTER,
      '--eval',
      script,
    ]);
  }
  return run('npx', [
    'tsx',
    '--tsconfig',
    TSX_TSCONFIG,
    '--require',
    SDK_ALIAS_REGISTER,
    '--eval',
    script,
  ]);
}

function discoverSourceFiles(moduleRoot) {
  const files = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.ploykit' || entry.name === 'migrations') {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }
  visit(moduleRoot);
  return files.sort();
}

function runModuleTypecheck(moduleRoot) {
  const sourceFiles = discoverSourceFiles(moduleRoot);
  if (sourceFiles.length === 0) {
    return {
      command: 'no module source files found',
      ok: true,
      status: 0,
      stdout: '',
      stderr: '',
      files: [],
    };
  }
  const tempDir = path.join(PROJECT_ROOT, '.runtime', 'module-test-tsconfig');
  fs.mkdirSync(tempDir, { recursive: true });
  const tsconfigFile = path.join(tempDir, `${path.basename(moduleRoot)}-${process.pid}.json`);
  const include = sourceFiles.map((file) => slash(file));
  fs.writeFileSync(
    tsconfigFile,
    `${JSON.stringify(
      {
        extends: '../../tsconfig.json',
        compilerOptions: {
          types: ['node'],
        },
        include,
        exclude: [],
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  const localTsc = path.join(PROJECT_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  const result = fs.existsSync(localTsc)
    ? run(process.execPath, [localTsc, '--noEmit', '--project', tsconfigFile])
    : run('npx', ['tsc', '--noEmit', '--project', tsconfigFile]);
  fs.rmSync(tsconfigFile, { force: true });
  return {
    ...result,
    files: sourceFiles,
  };
}

function loadModuleDefinitionForSmoke(moduleRoot) {
  const script = `
    import { pathToFileURL } from 'node:url';
    import(pathToFileURL(${JSON.stringify(path.join(moduleRoot, 'module.ts'))}).href)
      .then((loaded) => {
        let current = loaded;
        for (let index = 0; index < 5; index += 1) {
          if (!current || typeof current !== 'object' || !('default' in current)) break;
          current = current.default;
        }
        const definition = current;
        const result = {
          resources: Object.fromEntries(Object.entries(definition.resources ?? {}).filter(([, value]) => value?.$$type === 'ploykit.resource').map(([name, value]) => [name, { schema: Boolean(value.schema), storage: Boolean(value.storage?.table || value.storage?.document), pages: value.pages ?? {} }])),
          pages: (definition.pages ?? []).map((page) => ({ id: page.id, area: page.area, path: page.path, frame: page.frame, component: page.component })),
          apis: (definition.apis ?? []).map((api) => ({ id: api.id, input: Boolean(api.input), output: Boolean(api.output), handler: api.handler })),
          actions: Object.fromEntries(Object.entries(definition.actions ?? {}).map(([name, action]) => [name, { input: Boolean(action.input), handler: action.handler }]))
        };
        process.stdout.write(JSON.stringify(result));
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.stack || error.message : String(error));
        process.exit(1);
      });
  `;
  return runTsxEval(script);
}

function runPageRenderSmoke(moduleRoot) {
  const script = `
    import fs from 'node:fs';
    import path from 'node:path';
    import { pathToFileURL } from 'node:url';
    import React, { isValidElement } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';

    const moduleRoot = ${JSON.stringify(moduleRoot)};
    const failures = [];

    function unwrapDefault(value) {
      let current = value;
      for (let index = 0; index < 5; index += 1) {
        if (!current || typeof current !== 'object' || !('default' in current)) break;
        current = current.default;
      }
      return current;
    }

    function resolveCandidate(localPath) {
      if (typeof localPath !== 'string' || localPath.trim().length === 0) {
        return null;
      }
      const base = path.resolve(moduleRoot, localPath.replace(/^\\.\\//, ''));
      const candidates = [
        base,
        base + '.tsx',
        base + '.ts',
        base + '.jsx',
        base + '.js',
        path.join(base, 'index.tsx'),
        path.join(base, 'index.ts'),
        path.join(base, 'index.jsx'),
        path.join(base, 'index.js'),
      ];
      return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
    }

    function renderProps(page) {
      return {
        params: {},
        loaderData: null,
        metadata: {},
        language: 'en',
        dashboardBaseHref: '/dashboard',
        localizedDashboardHref: (target = '/') => '/dashboard' + (target === '/' ? '' : target),
        page,
      };
    }

    try {
      const definition = unwrapDefault(await import(pathToFileURL(path.join(moduleRoot, 'module.ts')).href));
      const pages = Array.isArray(definition?.pages) ? definition.pages : [];
      for (const [index, page] of pages.entries()) {
        if (!page?.frame) {
          failures.push('pages.' + index + '.frame');
        }
        const componentPath = resolveCandidate(page?.component);
        if (!componentPath) {
          failures.push('pages.' + index + '.component import');
          continue;
        }
        let component;
        try {
          component = unwrapDefault(await import(pathToFileURL(componentPath).href));
        } catch (error) {
          failures.push('pages.' + index + '.component import: ' + (error instanceof Error ? error.message : String(error)));
          continue;
        }
        if (typeof component !== 'function' && !isValidElement(component)) {
          failures.push('pages.' + index + '.component export');
          continue;
        }
        try {
          const element = isValidElement(component)
            ? component
            : React.createElement(component, renderProps(page));
          renderToStaticMarkup(element);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const stage = /Objects are not valid as a React child|plain object|JSON/i.test(message)
            ? 'renderOutput'
            : 'render';
          failures.push('pages.' + index + '.' + stage + ': ' + message);
        }
      }
    } catch (error) {
      failures.push('module.import: ' + (error instanceof Error ? error.message : String(error)));
    }

    if (failures.length > 0) {
      process.stdout.write('Failed checks: ' + failures.join(', '));
      process.exit(1);
    }
  `;
  return runTsxEval(script);
}

function runContractSmoke(moduleRoot, name) {
  if (name === 'page-render-smoke') {
    const result = runPageRenderSmoke(moduleRoot);
    return {
      ...result,
      command: 'page-render-smoke React render smoke',
    };
  }

  const loaded = loadModuleDefinitionForSmoke(moduleRoot);
  if (!loaded.ok) {
    return loaded;
  }
  const facts = JSON.parse(loaded.stdout || '{}');
  const failures = [];
  if (name === 'resource-smoke') {
    for (const [resourceName, resource] of Object.entries(facts.resources ?? {})) {
      if (!resource.schema) {
        failures.push(`resources.${resourceName}.schema`);
      }
      if (!resource.storage) {
        failures.push(`resources.${resourceName}.storage`);
      }
    }
  }
  if (name === 'api-action-schema-smoke') {
    for (const [index, api] of (facts.apis ?? []).entries()) {
      if (!api.input || !api.output) {
        failures.push(`apis.${index}.schema`);
      }
    }
    for (const [actionName, action] of Object.entries(facts.actions ?? {})) {
      if (!action.input) {
        failures.push(`actions.${actionName}.input`);
      }
    }
  }
  return {
    command: `${name} static contract smoke`,
    ok: failures.length === 0,
    status: failures.length === 0 ? 0 : 1,
    stdout: failures.length === 0 ? '' : `Failed checks: ${failures.join(', ')}`,
    stderr: '',
  };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp() {
  process.stdout.write(`Usage: npm run module:test -- <module-id|module-root|all> [--summary|--json] [--real]

Runs module doctor and module-local fake-host tests. Use --real to also run host runtime tests.

Options:
  --summary  Print a compact human-readable summary to stdout.
  --json     Print the full JSON report to stdout. This is the default.
  --real     Include the real-host runtime test step.
  -h, --help Show this help.

Reports:
  Full JSON reports are always written to .runtime/module-test-reports/<module-id>.json.
  The all target also writes .runtime/module-test-reports/all.json.

Exit codes:
  0 when every executed step passes, including warning-only doctor diagnostics.
  1 when target resolution fails or any doctor, fake-host, or real-host step fails.
`);
}

function countLines(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.split(/\r?\n/).length : 0;
}

function firstLine(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.split(/\r?\n/)[0]?.slice(0, 500) : '';
}

function summarizeStep(step) {
  const summary = {
    name: step.name,
    ok: Boolean(step.ok),
    status: Number(step.status ?? (step.ok ? 0 : 1)),
    command: step.command,
  };
  if (Array.isArray(step.files)) {
    summary.files = step.files.length;
  }
  const stdoutLines = countLines(step.stdout);
  const stderrLines = countLines(step.stderr);
  if (stdoutLines > 0) {
    summary.stdoutLines = stdoutLines;
  }
  if (stderrLines > 0) {
    summary.stderrLines = stderrLines;
  }
  if (!summary.ok) {
    const detail = firstLine(step.stdout) || firstLine(step.stderr);
    if (detail) {
      summary.detail = detail;
    }
  }
  return summary;
}

function summarizeModuleReport(report) {
  const steps = Array.isArray(report.steps) ? report.steps.map(summarizeStep) : [];
  return {
    moduleId: report.moduleId,
    moduleRoot: report.moduleRoot,
    success: Boolean(report.success),
    mode: report.mode,
    steps,
    reportFile: report.reportFile,
  };
}

function summarizeReport(report) {
  if (Array.isArray(report.results)) {
    const results = report.results.map(summarizeModuleReport);
    return {
      success: Boolean(report.success),
      mode: report.mode,
      count: Number(report.count ?? results.length),
      passed: results.filter((result) => result.success).length,
      failed: results.filter((result) => !result.success).length,
      reportFile: report.reportFile,
      results,
    };
  }
  if (Array.isArray(report.diagnostics)) {
    return {
      success: false,
      diagnostics: report.diagnostics,
    };
  }
  return summarizeModuleReport(report);
}

function stepLabel(step) {
  return `${step.name} ${step.ok ? 'passed' : 'failed'} (${step.status})`;
}

function formatModuleSummary(moduleSummary) {
  const status = moduleSummary.success ? 'passed' : 'failed';
  const lines = [
    `- ${moduleSummary.moduleId}: ${status}`,
    `  root: ${moduleSummary.moduleRoot}`,
    `  mode: ${moduleSummary.mode}`,
    `  steps: ${moduleSummary.steps.map(stepLabel).join(', ') || 'none'}`,
  ];
  for (const step of moduleSummary.steps) {
    if (!step.ok && step.detail) {
      lines.push(`  ${step.name}: ${step.detail}`);
    }
  }
  if (moduleSummary.reportFile) {
    lines.push(`  report: ${moduleSummary.reportFile}`);
  }
  return lines;
}

function printSummary(report) {
  const summary = summarizeReport(report);
  const lines = ['Module test summary:'];
  if (Array.isArray(summary.diagnostics)) {
    lines.push('- status: failed');
    lines.push(`- diagnostics: ${summary.diagnostics.length}`);
    for (const diagnostic of summary.diagnostics) {
      lines.push(`  - ${diagnostic.code}: ${diagnostic.message}`);
    }
    process.stdout.write(`${lines.join('\n')}\n`);
    return;
  }
  if (Array.isArray(summary.results)) {
    lines.push(`- status: ${summary.success ? 'passed' : 'failed'}`);
    lines.push(`- modules: ${summary.passed}/${summary.count} passed`);
    lines.push(`- mode: ${summary.mode}`);
    if (summary.reportFile) {
      lines.push(`- report: ${summary.reportFile}`);
    }
    for (const moduleSummary of summary.results) {
      lines.push(...formatModuleSummary(moduleSummary));
    }
    process.stdout.write(`${lines.join('\n')}\n`);
    return;
  }
  lines.push(`- status: ${summary.success ? 'passed' : 'failed'}`);
  lines.push(...formatModuleSummary(summary));
  process.stdout.write(`${lines.join('\n')}\n`);
}

function printReport(report, options) {
  if (options.output === 'summary') {
    printSummary(report);
    return;
  }
  printJson(report);
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

function saveAllReport(report) {
  const reportFile = path.join(PROJECT_ROOT, '.runtime', 'module-test-reports', 'all.json');
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  return toProjectPath(reportFile);
}

function invalidTarget(target, message) {
  return {
    success: false,
    diagnostics: [
      {
        severity: 'error',
        code: 'MODULE_TEST_TARGET_INVALID',
        message,
        path: target,
        fix: 'Pass a module id, a module root path, or all from ploykit.config.json.',
      },
    ],
  };
}

function runModuleTest(moduleRoot, options) {
  if (!fs.existsSync(path.join(moduleRoot, 'module.ts'))) {
    return invalidTarget(options.target, `Target "${options.target}" is not a module root.`);
  }

  const steps = [];
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

  steps.push({ name: 'typecheck', ...runModuleTypecheck(moduleRoot) });
  steps.push({ name: 'resource-smoke', ...runContractSmoke(moduleRoot, 'resource-smoke') });
  steps.push({ name: 'page-render-smoke', ...runContractSmoke(moduleRoot, 'page-render-smoke') });
  steps.push({
    name: 'api-action-schema-smoke',
    ...runContractSmoke(moduleRoot, 'api-action-schema-smoke'),
  });

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
    moduleId: readModuleIdFromSource(moduleRoot),
    mode: options.real ? 'real' : 'fake',
    steps,
    checkedAt: new Date().toISOString(),
  };
  report.reportFile = saveReport(moduleRoot, report);
  return report;
}

function resolveTargetRoots(options) {
  if (!options.target || options.target === 'all') {
    return discoverModuleRoots(PROJECT_ROOT, 'all');
  }
  return [resolveModuleRoot(PROJECT_ROOT, options.target)];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  let moduleRoots;
  try {
    moduleRoots = resolveTargetRoots(options);
  } catch (error) {
    printReport({
      ...invalidTarget(options.target, error instanceof Error ? error.message : String(error)),
    }, options);
    process.exitCode = 1;
    return;
  }

  const moduleReports = moduleRoots.map((moduleRoot) => runModuleTest(moduleRoot, options));
  if (moduleReports.some((report) => !report.success && Array.isArray(report.diagnostics))) {
    printReport(moduleReports.length === 1 ? moduleReports[0] : { success: false, results: moduleReports }, options);
    process.exitCode = 1;
    return;
  }

  const success = moduleReports.every((report) => report.success);
  const report =
    moduleReports.length === 1 && options.target !== 'all'
      ? moduleReports[0]
      : {
          success,
          count: moduleReports.length,
          mode: options.real ? 'real' : 'fake',
          results: moduleReports,
          checkedAt: new Date().toISOString(),
        };
  if ('results' in report) {
    report.reportFile = saveAllReport(report);
  }
  printReport(report, options);
  if (!success) {
    process.exitCode = 1;
  }
}

main();
