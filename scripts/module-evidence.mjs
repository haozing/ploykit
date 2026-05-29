import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function usage() {
  return [
    'Usage:',
    '  npm run module:evidence -- --module <id> --file <module-local-script> [options] -- [script args]',
    '',
    'Options:',
    '  --module <id>       Module id from src/lib/module-map.manifest.json.',
    '  --file <path>       Script path relative to the module root.',
    '  --runner <runner>   auto, node, or tsx. Defaults to auto.',
    '  --cwd <cwd>         project or module. Defaults to project.',
    '  --id <id>           Evidence command id for wrapper artifacts.',
    '  --manifest <path>   Module map manifest path. Defaults to src/lib/module-map.manifest.json.',
  ].join('\n');
}

function fail(message, status = 1) {
  process.stderr.write(`${message}\n\n${usage()}\n`);
  process.exit(status);
}

function readOptions(argv) {
  const options = {
    runner: 'auto',
    cwd: 'project',
    manifest: path.join('src', 'lib', 'module-map.manifest.json'),
    scriptArgs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      options.scriptArgs = argv.slice(index + 1);
      return options;
    }
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }

    const nextValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        fail(`Missing value for ${arg}.`);
      }
      index += 1;
      return value;
    };

    switch (arg) {
      case '--module':
        options.moduleId = nextValue();
        break;
      case '--file':
        options.file = nextValue();
        break;
      case '--runner':
        options.runner = nextValue();
        break;
      case '--cwd':
        options.cwd = nextValue();
        break;
      case '--id':
        options.id = nextValue();
        break;
      case '--manifest':
        options.manifest = nextValue();
        break;
      default:
        fail(`Unknown module:evidence option: ${arg}. Put module script args after --.`);
    }
  }

  return options;
}

function safeId(value) {
  return String(value).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '') || 'evidence';
}

function slash(value) {
  return value.replace(/\\/g, '/');
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`Unable to read module manifest at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveModule(manifestPath, moduleId) {
  const manifest = readJson(manifestPath);
  const modules = Array.isArray(manifest.modules) ? manifest.modules : [];
  const moduleInfo = modules.find((item) => item && item.id === moduleId);
  if (!moduleInfo) {
    fail(`Module "${moduleId}" was not found in ${manifestPath}.`);
  }
  if (typeof moduleInfo.rootDir !== 'string' || moduleInfo.rootDir.trim() === '') {
    fail(`Module "${moduleId}" does not declare a rootDir in ${manifestPath}.`);
  }
  return moduleInfo;
}

function resolveRunner(runner, scriptPath) {
  if (!['auto', 'node', 'tsx'].includes(runner)) {
    fail(`Unsupported runner "${runner}". Use auto, node, or tsx.`);
  }
  if (runner !== 'auto') {
    return runner;
  }
  return ['.ts', '.tsx'].includes(path.extname(scriptPath).toLowerCase()) ? 'tsx' : 'node';
}

function localBin(name) {
  const fileName = process.platform === 'win32' ? `${name}.cmd` : name;
  const candidate = path.join(projectRoot, 'node_modules', '.bin', fileName);
  return fs.existsSync(candidate) ? candidate : null;
}

function commandForRunner(runner, scriptPath, scriptArgs) {
  if (runner === 'node') {
    return {
      command: process.execPath,
      args: [scriptPath, ...scriptArgs],
      shell: false,
    };
  }

  const tsxBin = localBin('tsx');
  if (tsxBin) {
    return {
      command: tsxBin,
      args: [scriptPath, ...scriptArgs],
      shell: process.platform === 'win32',
    };
  }

  return {
    command: npmCommand,
    args: ['exec', '--', 'tsx', scriptPath, ...scriptArgs],
    shell: process.platform === 'win32',
  };
}

const options = readOptions(process.argv.slice(2));
if (!options.moduleId) {
  fail('Missing required --module option.');
}
if (!options.file) {
  fail('Missing required --file option.');
}
if (!['project', 'module'].includes(options.cwd)) {
  fail(`Unsupported --cwd "${options.cwd}". Use project or module.`);
}

const manifestPath = path.resolve(projectRoot, options.manifest);
const moduleInfo = resolveModule(manifestPath, options.moduleId);
const moduleRoot = path.resolve(projectRoot, moduleInfo.rootDir);
const moduleRootReal = fs.realpathSync(moduleRoot);
const scriptCandidate = path.resolve(moduleRoot, options.file);

if (!fs.existsSync(scriptCandidate)) {
  fail(`Module evidence script does not exist: ${scriptCandidate}`);
}

const scriptPath = fs.realpathSync(scriptCandidate);
if (!isInside(moduleRootReal, scriptPath)) {
  fail(
    `Module evidence script must stay inside module root. module=${slash(moduleRootReal)} script=${slash(scriptPath)}`
  );
}
if (!fs.statSync(scriptPath).isFile()) {
  fail(`Module evidence script is not a file: ${scriptPath}`);
}

const runner = resolveRunner(options.runner, scriptPath);
const evidenceId = safeId(options.id ?? path.basename(scriptPath, path.extname(scriptPath)));
const checkedAt = new Date().toISOString();
const outputDir = path.resolve(
  projectRoot,
  '.runtime',
  'module-evidence',
  options.moduleId,
  evidenceId,
  checkedAt.replace(/[:.]/g, '-')
);
const latestPath = path.resolve(
  projectRoot,
  '.runtime',
  'module-evidence',
  options.moduleId,
  evidenceId,
  'latest.json'
);
const stdoutLog = path.join(outputDir, 'stdout.log');
const stderrLog = path.join(outputDir, 'stderr.log');
fs.mkdirSync(outputDir, { recursive: true });

const command = commandForRunner(runner, scriptPath, options.scriptArgs);
const startedAt = Date.now();
const result = spawnSync(command.command, command.args, {
  cwd: options.cwd === 'module' ? moduleRootReal : projectRoot,
  encoding: 'utf8',
  shell: command.shell,
  maxBuffer: 20 * 1024 * 1024,
  env: {
    ...process.env,
    PLOYKIT_PROJECT_ROOT: projectRoot,
    PLOYKIT_MODULE_ID: options.moduleId,
    PLOYKIT_MODULE_ROOT: moduleRootReal,
    PLOYKIT_MODULE_EVIDENCE_ID: evidenceId,
    PLOYKIT_MODULE_EVIDENCE_OUTPUT_DIR: outputDir,
  },
});
fs.writeFileSync(stdoutLog, result.stdout ?? '');
fs.writeFileSync(stderrLog, result.stderr ?? '');

const status = result.status ?? (result.error ? 1 : 0);
const report = {
  ok: status === 0,
  checkedAt,
  durationMs: Date.now() - startedAt,
  moduleId: options.moduleId,
  moduleRoot: slash(moduleRootReal),
  evidenceId,
  runner,
  cwd: options.cwd,
  script: slash(path.relative(moduleRootReal, scriptPath)),
  scriptArgs: options.scriptArgs,
  command: {
    executable: command.command,
    args: command.args,
  },
  status,
  signal: result.signal ?? null,
  error: result.error?.message,
  artifacts: {
    outputDir,
    stdoutLog,
    stderrLog,
    latest: latestPath,
  },
};

fs.mkdirSync(path.dirname(latestPath), { recursive: true });
fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
fs.copyFileSync(path.join(outputDir, 'report.json'), latestPath);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ok ? 0 : status || 1;
