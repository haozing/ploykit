import path from 'node:path';
import { register } from 'tsx/esm/api';
import { createModuleDataCommandDependencies } from './lib/module-data-command-dependencies.mjs';
import { runModuleDataCliCommand } from './lib/module-data-cli-runner.mjs';
import './lib/module-sdk-alias.cjs';

const PROJECT_ROOT = process.cwd();
const TSX_TSCONFIG = path.join(PROJECT_ROOT, 'tsconfig.json');
const tsx = register({ namespace: 'ploykit-module-data', tsconfig: TSX_TSCONFIG });

function diagnostic(severity, code, message, pathValue, fix, details) {
  return {
    severity,
    code,
    message,
    ...(pathValue ? { path: pathValue } : {}),
    ...(fix ? { fix } : {}),
    ...(details ? { details } : {}),
  };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const commandDependencies = createModuleDataCommandDependencies({
  diagnostic,
  importModule: (url, parentUrl) => tsx.import(url, parentUrl),
  parentUrl: import.meta.url,
  projectRoot: PROJECT_ROOT,
  printJson,
});

await runModuleDataCliCommand({
  argv: process.argv,
  commands: commandDependencies.commands,
  createErrorDiagnostic(error) {
    return diagnostic(
      'error',
      'MODULE_DATA_CLI_ERROR',
      error instanceof Error ? error.message : String(error)
    );
  },
  onFinally: () => tsx.unregister(),
  printJson,
});
