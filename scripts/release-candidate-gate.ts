import { runReleaseCandidateGate } from '../src/lib/module-runtime/release/rc-gate';

function readProfile() {
  const index = process.argv.indexOf('--profile');
  const value = index >= 0 ? process.argv[index + 1] : 'local';
  if (value !== 'local' && value !== 'integration' && value !== 'maintainer') {
    throw new Error(
      `Unsupported release gate profile "${value}". Use local, integration, or maintainer.`
    );
  }
  return value;
}

const profile = readProfile();
const requiredChecks =
  profile === 'maintainer'
    ? {
        'module-contract': true,
        'web-shell': true,
        'host-product-smoke': true,
        'dashboard-transition-smoke': true,
        'runtime-stores': true,
        'production-adapters': true,
        'security-operations': true,
        'demo-products': true,
        'provider-live-matrix': true,
        'worker-soak': true,
        'delivery-ledger': true,
        'browser-matrix': true,
        'accessibility-smoke': true,
        'module-quality': true,
        'product-presentation-kernel': true,
        'white-label-presentation': true,
        'data-safety-matrix': true,
        'drift-check-matrix': true,
        'backup-restore-matrix': true,
        'postgres-physical-restore-matrix': true,
        'upgrade-migration-matrix': true,
        'chaos-matrix': true,
        'commercial-domain': true,
        'provider-invocation-ledger': true,
        'ai-rag-policy': true,
        documentation: true,
      }
    : undefined;
const result = runReleaseCandidateGate({
  projectRoot: process.cwd(),
  profile,
  requiredChecks,
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 1;
