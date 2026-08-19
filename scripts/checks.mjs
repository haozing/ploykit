import { spawnSync } from 'node:child_process';
import path from 'node:path';

const tsx = path.resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');
const checks = {
  docs: [{ runner: 'node', file: 'scripts/docs-encoding-check.mjs' }],
  presentation: [{ runner: 'tsx', file: 'scripts/presentation-check.ts' }],
  theme: [{ runner: 'tsx', file: 'scripts/theme-check.ts' }],
  i18n: [{ runner: 'tsx', file: 'scripts/i18n-check.ts' }],
  seo: [{ runner: 'tsx', file: 'scripts/seo-check.ts' }],
  'white-label': [{ runner: 'tsx', file: 'scripts/white-label-smoke.ts' }],
  drift: [{ runner: 'node', file: 'scripts/drift-check.mjs' }],
};

const [check = 'all', ...args] = process.argv.slice(2);
const names = check === 'all' ? Object.keys(checks) : [check];

if (names.some((name) => !checks[name])) {
  const unknown = names.find((name) => !checks[name]);
  process.stderr.write(`Unknown check: ${unknown}\n\n`);
  process.stdout.write(
    `Usage: npm run check -- <check> [args]\n\nChecks:\n${Object.keys(checks)
      .sort()
      .map((name) => `  ${name}`)
      .concat('  all')
      .join('\n')}\n`
  );
  process.exitCode = 1;
} else {
  for (const name of names) {
    for (const command of checks[name]) {
      const executable = command.runner === 'tsx' ? process.execPath : process.execPath;
      const commandArgs = command.runner === 'tsx'
        ? [tsx, path.resolve(process.cwd(), command.file), ...args]
        : [path.resolve(process.cwd(), command.file), ...args];
      const result = spawnSync(executable, commandArgs, {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'inherit',
      });
      if (result.status !== 0) {
        process.exitCode = result.status ?? 1;
        process.exit();
      }
    }
  }
}
