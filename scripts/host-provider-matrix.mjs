import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const required = process.argv.includes('--required');
const requireExternalProviders = process.env.PLOYKIT_PROVIDER_MATRIX_EXTERNAL === '1';

function configured(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.length > 0;
}

function missing(names) {
  return names.filter((name) => !configured(name));
}

function hasAll(names) {
  return missing(names).length === 0;
}

function resolveProviders() {
  const s3Required = ['S3_BUCKET', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  const stripeCheckoutRequired = ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_DEMO_PRO_MONTHLY'];
  const emailMode = process.env.PLOYKIT_EMAIL_PROVIDER ?? 'log';
  const fileMode = process.env.PLOYKIT_FILE_STORAGE ?? 'local';
  const billingMode =
    process.env.PLOYKIT_BILLING_PROVIDER ?? (configured('STRIPE_SECRET_KEY') ? 'stripe' : 'local');
  const aiMode = process.env.PLOYKIT_AI_PROVIDER ?? 'static';
  const ragMode = process.env.PLOYKIT_RAG_PROVIDER ?? 'memory-vector';
  const runtimeStoreDurable = Boolean(process.env.DATABASE_URL ?? process.env.POSTGRES_URL);
  const aiWebhookRequired = [
    'PLOYKIT_AI_WEBHOOK_URL',
    ...(required ? ['PLOYKIT_AI_WEBHOOK_SECRET'] : []),
  ];
  const aiRequired =
    aiMode === 'static' || aiMode === 'local-test'
      ? []
      : aiMode === 'webhook'
        ? aiWebhookRequired
        : ['PLOYKIT_AI_API_KEY'];

  return {
    files: {
      mode: fileMode,
      configured: fileMode !== 's3' || hasAll(s3Required),
      durable: fileMode !== 'memory',
      degraded: fileMode === 'memory' || (fileMode === 's3' && !hasAll(s3Required)),
      requiredMissing: fileMode === 's3' ? missing(s3Required) : [],
    },
    billing: {
      mode: billingMode,
      configured: billingMode !== 'stripe' || hasAll(stripeCheckoutRequired),
      degraded:
        billingMode === 'local' || (billingMode === 'stripe' && !hasAll(stripeCheckoutRequired)),
      requiredMissing: billingMode === 'stripe' ? missing(stripeCheckoutRequired) : [],
    },
    email: {
      mode: emailMode,
      configured:
        emailMode !== 'webhook' ||
        (configured('PLOYKIT_EMAIL_WEBHOOK_URL') && configured('PLOYKIT_EMAIL_WEBHOOK_SECRET')),
      degraded: emailMode === 'log',
      requiredMissing:
        emailMode === 'webhook'
          ? missing(['PLOYKIT_EMAIL_WEBHOOK_URL', 'PLOYKIT_EMAIL_WEBHOOK_SECRET'])
          : [],
    },
    ai: {
      mode: aiMode,
      configured: aiRequired.length === 0 || hasAll(aiRequired),
      degraded:
        aiMode === 'static' ||
        aiMode === 'local-test' ||
        (aiMode === 'webhook' && !hasAll(aiRequired)),
      requiredMissing: missing(aiRequired),
    },
    rag: {
      mode: ragMode,
      configured: ragMode === 'memory-vector',
      durable: runtimeStoreDurable,
      degraded: !runtimeStoreDurable,
      requiredMissing: ragMode === 'memory-vector' ? [] : ['PLOYKIT_RAG_PROVIDER=memory-vector'],
    },
    notifications: {
      mode: 'runtime-store',
      configured: true,
      durable: runtimeStoreDurable,
      degraded: !runtimeStoreDurable,
      requiredMissing: [],
    },
  };
}

function providerConfigChecks(providers) {
  return Object.entries(providers).map(([id, detail]) => ({
    id: `provider-config:${id}`,
    ok: !required || detail.requiredMissing.length === 0,
    command: 'env provider resolution',
    durationMs: 0,
    detail,
    error:
      required && detail.requiredMissing.length > 0
        ? `Missing required provider env: ${detail.requiredMissing.join(', ')}`
        : undefined,
  }));
}

function parseCheckDetail(stdout) {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const objectStart = trimmed.indexOf('{');
    if (objectStart >= 0) {
      try {
        return JSON.parse(trimmed.slice(objectStart));
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
}

function runCheck(id, script, extraArgs = []) {
  const args = ['run', script, ...(extraArgs.length > 0 ? ['--', ...extraArgs] : [])];
  const startedAt = Date.now();
  const result = spawnSync(npm, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = (result.stdout ?? '').trim();
  const detail = parseCheckDetail(stdout);

  return {
    id,
    ok: result.status === 0,
    command: `npm ${args.join(' ')}`,
    durationMs: Date.now() - startedAt,
    detail,
    error:
      result.status === 0
        ? undefined
        : (result.error?.message ?? ((result.stderr ?? '').trim() || undefined)),
  };
}

function extractProviderInvocationLedger(detail) {
  if (!detail || typeof detail !== 'object') {
    return undefined;
  }
  if (detail.domainEvidence?.providerInvocationLedger) {
    return detail.domainEvidence.providerInvocationLedger;
  }
  for (const check of detail.checks ?? []) {
    if (check?.detail?.providerInvocationLedger) {
      return check.detail.providerInvocationLedger;
    }
    if (check?.detail?.domainEvidence?.providerInvocationLedger) {
      return check.detail.domainEvidence.providerInvocationLedger;
    }
  }
  return undefined;
}

function mergeProviderInvocationLedgers(ledgers) {
  const merged = {
    invocations: 0,
    successful: 0,
    failed: 0,
    operations: [],
    kinds: [],
    ragSources: 0,
    ragChunks: 0,
    connectorInvocations: 0,
  };
  const operations = new Set();
  const kinds = new Set();
  for (const ledger of ledgers) {
    if (!ledger || typeof ledger !== 'object') {
      continue;
    }
    merged.invocations += Number(ledger.invocations ?? 0);
    merged.successful += Number(ledger.successful ?? 0);
    merged.failed += Number(ledger.failed ?? 0);
    merged.ragSources += Number(ledger.ragSources ?? 0);
    merged.ragChunks += Number(ledger.ragChunks ?? 0);
    merged.connectorInvocations += Number(ledger.connectorInvocations ?? 0);
    for (const operation of Array.isArray(ledger.operations) ? ledger.operations : []) {
      operations.add(String(operation));
    }
    for (const kind of Array.isArray(ledger.kinds) ? ledger.kinds : []) {
      kinds.add(String(kind));
    }
  }
  merged.operations = [...operations].sort();
  merged.kinds = [...kinds].sort();
  return merged;
}

const providers = resolveProviders();
const checks = [
  ...providerConfigChecks(providers),
  runCheck('local-provider-depth', 'host:local-provider-smoke'),
  runCheck('files-cleanup', 'host:files-cleanup-smoke'),
  runCheck('files-reconcile', 'host:files-reconcile-smoke'),
  runCheck('s3-local-minio', 'host:s3-local-smoke'),
  runCheck('ai-rag-local', 'host:ai-rag-local-smoke'),
  runCheck('ai-webhook-local', 'host:ai-webhook-local-smoke'),
  runCheck('rag-provider', 'host:rag-provider-smoke'),
  runCheck('stripe-local-mock', 'host:stripe-local-smoke'),
  runCheck('s3-compatible-storage', 'host:s3-smoke', [
    ...(required && requireExternalProviders ? ['--required', '--check-signed-url'] : []),
  ]),
  runCheck('stripe-commerce', 'host:stripe-smoke', [
    ...(required && requireExternalProviders ? ['--required'] : []),
    '--apply-ledger',
  ]),
  runCheck('billing-reconcile', 'host:billing-reconcile-smoke'),
  runCheck('email-local-webhook', 'host:email-local-webhook-smoke'),
  runCheck(
    'email-delivery',
    'host:email-smoke',
    required && requireExternalProviders ? ['--required'] : []
  ),
];
const providerInvocationLedger = mergeProviderInvocationLedgers(
  checks.map((check) => extractProviderInvocationLedger(check.detail))
);

const checkedAt = new Date().toISOString();
const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'provider-matrix',
  checkedAt.replace(/[:.]/g, '-')
);
const latestPath = path.resolve(process.cwd(), '.runtime', 'provider-matrix', 'latest.json');
const reportPath = path.join(outputDir, 'matrix.json');
const matrix = {
  ok: checks.every((check) => check.ok),
  required,
  checkedAt,
  providers,
  domainEvidence: {
    providerInvocationLedger,
  },
  checks,
  artifacts: {
    report: reportPath,
    latest: latestPath,
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(latestPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(matrix, null, 2)}\n`);
fs.copyFileSync(reportPath, latestPath);

process.stdout.write(`${JSON.stringify(matrix, null, 2)}\n`);
process.exitCode = matrix.ok ? 0 : 1;
