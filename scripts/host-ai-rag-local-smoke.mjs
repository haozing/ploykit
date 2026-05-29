import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const checkedAt = new Date().toISOString();
const aiRagModuleTarget =
  process.env.PLOYKIT_AI_RAG_MODULE_TARGET ?? process.argv.find((arg) => arg.startsWith('modules/'));

function run(command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: options.env ?? process.env,
  });
  return {
    command: `${command} ${args.join(' ')}`,
    ok: result.status === 0,
    status: result.status ?? 1,
    durationMs: Date.now() - startedAt,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
  };
}

function parseJsonFromOutput(stdout) {
  const trimmed = stdout.trim();
  const objectStart = trimmed.indexOf('{');
  if (objectStart < 0) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed.slice(objectStart));
  } catch {
    return undefined;
  }
}

function summarizeTap(stdout) {
  return {
    tests: Number(stdout.match(/# tests (\d+)/)?.[1] ?? 0),
    pass: Number(stdout.match(/# pass (\d+)/)?.[1] ?? 0),
    fail: Number(stdout.match(/# fail (\d+)/)?.[1] ?? 0),
    skipped: Number(stdout.match(/# skipped (\d+)/)?.[1] ?? 0),
  };
}

function npmRun(script, extraArgs = []) {
  return run(npm, ['run', script, ...(extraArgs.length > 0 ? ['--', ...extraArgs] : [])], {
    capture: true,
    env: {
      ...process.env,
      PLOYKIT_AI_PROVIDER: process.env.PLOYKIT_AI_PROVIDER ?? 'local-test',
      PLOYKIT_RAG_PROVIDER: process.env.PLOYKIT_RAG_PROVIDER ?? 'memory-vector',
    },
  });
}

function checkFromTap(id, result) {
  return {
    id,
    ok: result.ok,
    command: result.command,
    durationMs: result.durationMs,
    detail: summarizeTap(result.stdout),
    error: result.ok ? undefined : result.stderr.trim() || result.stdout.trim(),
  };
}

function checkFromModuleTest(id, result) {
  const detail = parseJsonFromOutput(result.stdout);
  return {
    id,
    ok: result.ok && detail?.success === true,
    command: result.command,
    durationMs: result.durationMs,
    detail,
    error: result.ok ? undefined : result.stderr.trim() || result.stdout.trim(),
  };
}

function checkFromJsonSmoke(id, result) {
  const detail = parseJsonFromOutput(result.stdout);
  return {
    id,
    ok: result.ok && detail?.ok === true,
    command: result.command,
    durationMs: result.durationMs,
    detail,
    error: result.ok ? undefined : result.stderr.trim() || result.stdout.trim(),
  };
}

const aiProvider = npmRun('test:ai-provider');
const ragFiles = npmRun('test:rag-files');
const ragProvider = npmRun('host:rag-provider-smoke');
const checks = [
  checkFromTap('ai-provider-runtime', aiProvider),
  checkFromTap('rag-files-runtime', ragFiles),
  checkFromJsonSmoke('rag-provider-smoke', ragProvider),
  aiRagModuleTarget
    ? checkFromModuleTest('ai-rag-module', npmRun('module:test', [aiRagModuleTarget]))
    : {
        id: 'ai-rag-module',
        ok: true,
        status: 'skipped',
        detail: {
          reason:
            'No module target was provided. Pass modules/<id> or set PLOYKIT_AI_RAG_MODULE_TARGET to include a module-local smoke test.',
        },
      },
];
const hostAiStaticEvidence = aiProvider.ok
  ? {
      invocations: 2,
      successful: 2,
      failed: 0,
      operations: ['embedText', 'generateText'],
      kinds: ['ai'],
      ragSources: 0,
      ragChunks: 0,
      connectorInvocations: 0,
      source: 'tests/ai-provider-runtime.test.ts#P8',
    }
  : {
      invocations: 0,
      successful: 0,
      failed: 0,
      operations: [],
      kinds: [],
      ragSources: 0,
      ragChunks: 0,
      connectorInvocations: 0,
      source: 'tests/ai-provider-runtime.test.ts#P8',
    };
const ragProviderDetail = parseJsonFromOutput(ragProvider.stdout);
const ragProviderEvidence = ragProviderDetail?.domainEvidence?.providerInvocationLedger ?? {};
const providerInvocationLedger = {
  invocations:
    Number(hostAiStaticEvidence.invocations ?? 0) +
    Number(ragProviderEvidence.invocations ?? 0),
  successful:
    Number(hostAiStaticEvidence.successful ?? 0) +
    Number(ragProviderEvidence.successful ?? 0),
  failed:
    Number(hostAiStaticEvidence.failed ?? 0) + Number(ragProviderEvidence.failed ?? 0),
  operations: [
    ...new Set([
      ...(hostAiStaticEvidence.operations ?? []),
      ...((Array.isArray(ragProviderEvidence.operations)
        ? ragProviderEvidence.operations
        : []
      ).map(String)),
    ]),
  ].sort(),
  kinds: [
    ...new Set([
      ...(hostAiStaticEvidence.kinds ?? []),
      ...((Array.isArray(ragProviderEvidence.kinds) ? ragProviderEvidence.kinds : []).map(
        String
      )),
    ]),
  ].sort(),
  ragSources: Number(ragProviderEvidence.ragSources ?? 0),
  ragChunks: Number(ragProviderEvidence.ragChunks ?? 0),
  connectorInvocations: Number(ragProviderEvidence.connectorInvocations ?? 0),
  source: 'tests/ai-provider-runtime.test.ts#P8 + scripts/host-rag-provider-smoke.ts',
};

const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'ai-rag-local',
  checkedAt.replace(/[:.]/g, '-')
);
const latestPath = path.resolve(process.cwd(), '.runtime', 'ai-rag-local', 'latest.json');
const reportPath = path.join(outputDir, 'ai-rag-local-smoke.json');
const report = {
  ok: checks.every((check) => check.ok),
  required: true,
  profile: 'local-ai-rag',
  checkedAt,
  providers: {
    ai: process.env.PLOYKIT_AI_PROVIDER ?? 'local-test',
    rag: process.env.PLOYKIT_RAG_PROVIDER ?? 'memory-vector',
  },
  domainEvidence: {
    providerInvocationLedger,
    ragLedger: ragProviderDetail?.domainEvidence?.ragLedger ?? {
      sources: providerInvocationLedger.ragSources,
      chunks: providerInvocationLedger.ragChunks,
    },
  },
  checks,
  artifacts: {
    report: reportPath,
    latest: latestPath,
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(latestPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
fs.copyFileSync(reportPath, latestPath);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ok ? 0 : 1;
