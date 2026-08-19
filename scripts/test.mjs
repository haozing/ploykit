import { spawnSync } from 'node:child_process';
import path from 'node:path';

const groups = {
  module: [
    'tests/module-action-route.test.ts',
    'tests/developer-platform.test.ts',
    'tests/module-evidence-cli.test.ts',
    'tests/module-service-contract-cli.test.ts',
    'tests/module-map-cli.test.ts',
    'tests/developer-experience.test.ts',
    'tests/catalog-runtime.test.ts',
  ],
  runtime: [
    'tests/data-runtime.test.ts',
    'tests/ui-runtime-new.test.tsx',
    'tests/host-page-presentation.test.ts',
    'tests/files-runtime.test.ts',
    'tests/advanced-runtime.test.ts',
    'tests/advanced-runtime-data-cli.test.ts',
    'tests/advanced-runtime-verify-db.test.ts',
    'tests/advanced-runtime-data-command-helpers.test.ts',
    'tests/advanced-runtime-data-static-helpers.test.ts',
    'tests/product-scope-runtime.test.ts',
    'tests/runtime-stores.test.ts',
    'tests/runtime-stores-postgres.test.ts',
    'tests/runtime-stores-postgres-scope.test.ts',
    'tests/runtime-checks.test.ts',
  ],
  web: [
    'tests/web-shell.test.ts',
    'tests/web-shell-auth.test.ts',
    'tests/web-shell-email.test.ts',
    'tests/web-shell-operations-status.test.ts',
    'tests/web-shell-runtime-store.test.ts',
    'tests/web-shell-stripe.test.ts',
    'tests/web-shell-files.test.ts',
    'tests/web-shell-workers.test.ts',
    'tests/web-shell-settings.test.ts',
    'tests/web-shell-routing.test.ts',
    'tests/web-shell-identity.test.ts',
    'tests/web-shell-module-host.test.ts',
    'tests/web-shell-dead-letter.test.ts',
    'tests/web-shell-product-scope.test.ts',
    'tests/web-shell-admin-identity.test.ts',
    'tests/web-shell-service-connections.test.ts',
    'tests/web-shell-commercial.test.ts',
    'tests/seo-presentation.test.ts',
  ],
  commercial: [
    'tests/commercial-ledger.test.ts',
    'tests/commercial-ledger-primitives.test.ts',
    'tests/commercial-ledger-provider-flows.test.ts',
    'tests/commercial-postgres.test.ts',
  ],
  security: ['tests/security-runtime-services.test.ts', 'tests/security-hardening.test.ts'],
  ai: ['tests/ai-provider-runtime.test.ts', 'tests/rag-files-artifacts.test.ts', 'tests/files-storage-driver.test.ts'],
  release: [
    'tests/release-candidate.test.ts',
    'tests/release-candidate-runtime-evidence.test.ts',
  ],
};

const [group = 'all', ...args] = process.argv.slice(2);
const files =
  group === 'all'
    ? [...new Set(Object.values(groups).flat())]
    : groups[group];

if (!files) {
  process.stderr.write(`Unknown test group: ${group}\n\n`);
  process.stdout.write(
    `Usage: npm run test -- <group> [tsx args]\n\nGroups:\n${Object.keys(groups)
      .sort()
      .map((name) => `  ${name}`)
      .concat('  all')
      .join('\n')}\n`
  );
  process.exitCode = 1;
} else {
  const result = spawnSync(
    process.execPath,
    [
      path.resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
      '--test-concurrency=1',
      '--test',
      ...files,
      ...args,
    ],
    { cwd: process.cwd(), env: process.env, stdio: 'inherit' }
  );
  process.exitCode = result.status ?? 1;
}
