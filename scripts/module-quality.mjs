import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  collectModuleQualityEvidence,
  collectModuleQualityRoutes,
  collectModuleProductChecks,
  readModuleQualityManifest,
  routeViewports,
} from './module-quality-manifest.mjs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const required = process.argv.includes('--required');
const noRun = process.argv.includes('--no-run');
const projectRoot = process.cwd();
const targets = process.argv
  .slice(2)
  .filter((arg) => arg !== '--' && !arg.startsWith('--'))
  .map((arg) => arg.replace(/\\/g, '/').replace(/\/$/, ''));
const checkedAt = new Date().toISOString();
const outputDir = path.resolve(
  projectRoot,
  '.runtime',
  'module-quality',
  checkedAt.replace(/[:.]/g, '-')
);
const reportPath = path.join(outputDir, 'quality.json');
const latestPath = path.resolve(projectRoot, '.runtime', 'module-quality', 'latest.json');

function slash(value) {
  return value.replace(/\\/g, '/');
}

function safeId(value) {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'module';
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return { path: filePath, error: 'evidence is missing' };
  }
  try {
    return { path: filePath, report: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (error) {
    return { path: filePath, error: error instanceof Error ? error.message : String(error) };
  }
}

function runtimeLatest(runtimeDir) {
  return path.resolve(projectRoot, '.runtime', runtimeDir, 'latest.json');
}

function routeCheckIds(routes) {
  return routes.flatMap((route) => routeViewports(route).map((viewport) => `${viewport}:${route.path}`));
}

function validateRuntimeReport({ id, title, runtimeDir, requiredChecks = [] }) {
  const evidence = readJson(runtimeLatest(runtimeDir));
  if (!evidence.report) {
    return {
      id,
      title,
      ok: false,
      status: 'missing',
      runtimeDir,
      evidence: evidence.path,
      error: evidence.error,
    };
  }

  const report = evidence.report;
  const passedIds = new Set(
    Array.isArray(report.checks)
      ? report.checks.filter((check) => check?.ok === true).map((check) => check.id)
      : []
  );
  const missingChecks = requiredChecks.filter((checkId) => !passedIds.has(checkId));
  const ok =
    report.ok === true &&
    report.skipped !== true &&
    (!required || report.required === true) &&
    missingChecks.length === 0;

  return {
    id,
    title,
    ok,
    status: ok ? 'passed' : 'failed',
    runtimeDir,
    evidence: evidence.path,
    required: report.required === true,
    skipped: report.skipped === true,
    missingChecks,
    error: ok
      ? undefined
      : report.skipped === true
        ? report.reason ?? 'evidence was skipped'
        : missingChecks.length > 0
          ? `missing checks: ${missingChecks.join(', ')}`
          : report.ok === true && required && report.required !== true
            ? 'evidence was not generated with --required'
            : 'evidence did not pass',
  };
}

function runCommand(moduleId, evidence) {
  if (!evidence.command?.script || noRun) {
    return undefined;
  }
  const commandArgs = [
    'run',
    evidence.command.script,
    '--',
    ...(evidence.command.args ?? []),
    ...(required ? ['--required'] : []),
  ];
  const startedAt = Date.now();
  const result = spawnSync(npm, commandArgs, {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const commandDir = path.join(outputDir, 'commands');
  fs.mkdirSync(commandDir, { recursive: true });
  const prefix = `${safeId(moduleId)}-${safeId(evidence.id)}`;
  const stdoutLog = path.join(commandDir, `${prefix}.stdout.log`);
  const stderrLog = path.join(commandDir, `${prefix}.stderr.log`);
  fs.writeFileSync(stdoutLog, result.stdout ?? '');
  fs.writeFileSync(stderrLog, result.stderr ?? '');

  return {
    script: evidence.command.script,
    args: commandArgs.slice(3),
    ok: result.status === 0,
    status: result.status,
    durationMs: Date.now() - startedAt,
    stdoutLog,
    stderrLog,
    error: result.error?.message ?? (result.status === 0 ? undefined : result.stderr?.trim()),
  };
}

const manifest = readModuleQualityManifest(projectRoot);
const modules = manifest.modules
  .filter((moduleInfo) => {
    if (targets.length === 0) {
      return true;
    }
    const rootDir = slash(moduleInfo.rootDir ?? '');
    const absoluteRoot = rootDir ? slash(path.resolve(projectRoot, rootDir)) : '';
    return targets.some((target) => {
      const absoluteTarget = slash(path.resolve(projectRoot, target));
      return moduleInfo.id === target || rootDir === target || absoluteRoot === absoluteTarget;
    });
  })
  .map((moduleInfo) => ({ id: moduleInfo.id, name: moduleInfo.name }));

const moduleIds = new Set(modules.map((moduleInfo) => moduleInfo.id).filter(Boolean));
const browserRoutes = collectModuleQualityRoutes('browser', projectRoot).filter((route) =>
  moduleIds.has(route.moduleId)
);
const accessibilityRoutes = collectModuleQualityRoutes('accessibility', projectRoot).filter((route) =>
  moduleIds.has(route.moduleId)
);
const evidenceDeclarations = collectModuleQualityEvidence(projectRoot).filter((evidence) =>
  moduleIds.has(evidence.moduleId)
);
const productChecks = collectModuleProductChecks(projectRoot).filter((check) =>
  moduleIds.has(check.moduleId)
);

const checks = [];
if (manifest.error) {
  checks.push({
    id: 'module-quality-manifest',
    title: 'Module quality manifest',
    ok: false,
    status: 'missing',
    evidence: manifest.path,
    error: manifest.error,
  });
}
if (targets.length > 0 && modules.length === 0) {
  checks.push({
    id: 'module-quality-targets',
    title: 'Module quality target selection',
    ok: false,
    status: 'missing',
    error: `No modules matched targets: ${targets.join(', ')}`,
  });
}

if (browserRoutes.length > 0) {
  checks.push(
    validateRuntimeReport({
      id: 'browser-routes',
      title: 'Browser matrix includes module-declared routes',
      runtimeDir: 'browser-matrix',
      requiredChecks: routeCheckIds(browserRoutes),
    })
  );
}
if (accessibilityRoutes.length > 0) {
  checks.push(
    validateRuntimeReport({
      id: 'accessibility-routes',
      title: 'Accessibility smoke includes module-declared routes',
      runtimeDir: 'accessibility-smoke',
      requiredChecks: routeCheckIds(accessibilityRoutes),
    })
  );
}
for (const productCheck of productChecks) {
  checks.push(productCheck);
}

const commandResults = evidenceDeclarations.map((evidence) => ({
  moduleId: evidence.moduleId,
  id: evidence.id,
  command: runCommand(evidence.moduleId, evidence),
}));

for (const evidence of evidenceDeclarations) {
  checks.push(
    validateRuntimeReport({
      id: `${evidence.moduleId}:${evidence.id}`,
      title: evidence.title,
      runtimeDir: evidence.runtimeDir,
      requiredChecks: evidence.checks ?? [],
    })
  );
}

const moduleLatest = modules.map((moduleInfo) => {
  const moduleLatestPath = path.resolve(
    projectRoot,
    '.runtime',
    'modules',
    moduleInfo.id,
    'quality',
    'latest.json'
  );
  return { moduleId: moduleInfo.id, path: moduleLatestPath };
});

const report = {
  ok: checks.every((check) => check.ok),
  required,
  checkedAt,
  moduleIds: [...moduleIds],
  targets,
  checks,
  commands: commandResults,
  artifacts: {
    report: reportPath,
    latest: latestPath,
    modules: Object.fromEntries(moduleLatest.map((item) => [item.moduleId, item.path])),
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(latestPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
fs.copyFileSync(reportPath, latestPath);
for (const item of moduleLatest) {
  fs.mkdirSync(path.dirname(item.path), { recursive: true });
  fs.copyFileSync(reportPath, item.path);
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ok ? 0 : 1;
