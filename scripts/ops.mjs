import { spawn } from 'node:child_process';
import path from 'node:path';

const operations = {
  'host:ai-rag-local-smoke': 'scripts/host-ai-rag-local-smoke.mjs',
  'host:web-shell-evidence': 'scripts/host-web-shell-evidence.mjs',
  'host:backup-restore-smoke': 'scripts/host-backup-restore-smoke.ts',
  'host:postgres-physical-restore-smoke': 'scripts/host-postgres-physical-restore-smoke.ts',
  'host:upgrade-migration-smoke': 'scripts/host-upgrade-migration-smoke.ts',
  'host:chaos-smoke': 'scripts/host-chaos-smoke.ts',
  'host:data-safety': 'scripts/host-data-safety-matrix.ts',
  'host:postgres-local-smoke': 'scripts/host-postgres-local-smoke.mjs',
  'host:s3-smoke': 'scripts/host-s3-smoke.ts',
  'host:s3-local-smoke': 'scripts/host-s3-local-smoke.mjs',
  'host:stripe-smoke': 'scripts/host-stripe-smoke.ts',
  'host:stripe-local-smoke': {
    script: 'scripts/host-stripe-smoke.ts',
    args: ['--mock-stripe', '--required', '--apply-ledger'],
  },
  'host:billing-reconcile-smoke': 'scripts/host-billing-reconcile-smoke.ts',
  'host:ai-rag-policy-smoke': 'scripts/host-ai-rag-policy-smoke.ts',
  'host:ai-webhook-local-smoke': 'scripts/host-ai-webhook-local-smoke.ts',
  'host:rag-provider-smoke': 'scripts/host-rag-provider-smoke.ts',
  'host:email-smoke': 'scripts/host-email-smoke.ts',
  'host:email-local-webhook-smoke': 'scripts/host-email-local-webhook-smoke.ts',
  'host:files-cleanup-smoke': 'scripts/host-files-cleanup-smoke.ts',
  'host:files-reconcile-smoke': 'scripts/host-files-reconcile-smoke.ts',
  'host:local-provider-smoke': 'scripts/host-local-provider-smoke.ts',
  'host:worker-soak': 'scripts/host-worker-soak.ts',
};

const [operation, ...args] = process.argv.slice(2);

function printUsage() {
  process.stdout.write(
    `Usage: npm run ops -- <operation> [args]\n\nAvailable operations:\n${Object.keys(operations)
      .sort()
      .map((name) => `  ${name}`)
      .join('\n')}\n`
  );
}

if (!operation || operation === '--help' || operation === '-h') {
  printUsage();
  process.exitCode = operation ? 0 : 1;
} else if (!operations[operation]) {
  process.stderr.write(`Unknown operation: ${operation}\n\n`);
  printUsage();
  process.exitCode = 1;
} else {
  const definition =
    typeof operations[operation] === 'string'
      ? { script: operations[operation], args: [] }
      : operations[operation];
  const script = path.resolve(process.cwd(), definition.script);
  const command = process.execPath;
  const commandArgs = script.endsWith('.ts')
    ? [
        path.resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
        script,
        ...definition.args,
        ...args,
      ]
    : [script, ...definition.args, ...args];
  const child = spawn(command, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  child.on('error', (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
