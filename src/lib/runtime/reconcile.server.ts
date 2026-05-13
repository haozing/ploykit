/**
 * Runtime Reconcile
 *
 * Centralized runtime capability verification.
 * Checks that declared capabilities match actual runtime state.
 */

import { env } from '@/lib/_core/env';
import type {
  RuntimeCheck,
  RuntimeCheckResult,
  RuntimeReconcileOptions,
  RuntimeReport,
} from './types';

const DEFAULT_CHECK_TIMEOUT_MS = 10_000;

// Registry of all runtime checks
const checks = new Map<string, RuntimeCheck>();

/**
 * Register a runtime check
 */
export function registerCheck(check: RuntimeCheck): void {
  checks.set(check.name, check);
}

/**
 * Unregister a runtime check
 */
export function unregisterCheck(name: string): void {
  checks.delete(name);
}

/**
 * Run all registered checks and produce a runtime report
 */
export async function runReconcile(options: RuntimeReconcileOptions = {}): Promise<RuntimeReport> {
  const results: RuntimeCheckResult[] = [];
  let hasError = false;
  let hasWarning = false;

  for (const [, check] of checks) {
    const result = await runSingleCheck(check, options);
    results.push(result);

    if (result.severity === 'error') hasError = true;
    if (result.severity === 'warning') hasWarning = true;
  }

  const overall = hasError ? 'failed' : hasWarning ? 'degraded' : 'ok';

  return {
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
    overall,
    checks: results,
  };
}

async function runSingleCheck(
  check: RuntimeCheck,
  options: RuntimeReconcileOptions
): Promise<RuntimeCheckResult> {
  const startedAt = Date.now();
  const timeoutMs = check.timeoutMs ?? options.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;

  try {
    const result = await withTimeout(
      Promise.resolve().then(() => check.run()),
      timeoutMs,
      check.name
    );

    return {
      ...result,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      key: check.name,
      status: 'failed',
      severity: 'error',
      message,
      durationMs: Date.now() - startedAt,
      fix:
        error instanceof RuntimeCheckTimeoutError
          ? 'Increase the check timeout or move the slow probe to a less frequent full reconcile path.'
          : 'Review the check implementation',
    };
  }
}

class RuntimeCheckTimeoutError extends Error {
  constructor(checkName: string, timeoutMs: number) {
    super(`Check "${checkName}" timed out after ${timeoutMs}ms`);
    this.name = 'RuntimeCheckTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, checkName: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new RuntimeCheckTimeoutError(checkName, timeoutMs)),
      timeoutMs
    );
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

/**
 * Run checks and return whether all passed (no errors)
 */
export async function runReconcileStrict(): Promise<boolean> {
  const report = await runReconcile();
  return report.overall !== 'failed';
}

function writeStdout(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function writeStderr(line = ''): void {
  process.stderr.write(`${line}\n`);
}

/**
 * Run checks and fail process on errors (for CI/build gates)
 */
export async function runReconcileAndExit(): Promise<void> {
  const report = await runReconcile();

  writeStdout();
  writeStdout('========================================');
  writeStdout('  Runtime Reconcile Report');
  writeStdout(`  Environment: ${report.environment}`);
  writeStdout(`  Overall: ${report.overall.toUpperCase()}`);
  writeStdout('========================================');
  writeStdout();

  for (const check of report.checks) {
    const label =
      check.status === 'ok'
        ? 'OK'
        : check.status === 'warning'
          ? 'WARN'
          : check.status === 'skipped'
            ? 'SKIP'
            : 'FAIL';

    const duration = check.durationMs === undefined ? '' : ` (${check.durationMs}ms)`;
    writeStdout(`${label} [${check.status.toUpperCase()}] ${check.key}${duration}`);
    writeStdout(`   ${check.message}`);
    if (check.fix) {
      writeStdout(`   Fix: ${check.fix}`);
    }
    if (check.details && Object.keys(check.details).length > 0) {
      writeStdout(`   Details: ${JSON.stringify(check.details)}`);
    }
    writeStdout();
  }

  if (report.overall === 'failed') {
    writeStderr('Runtime reconcile failed. Fix the issues above before proceeding.');
    writeStderr();
    process.exit(1);
  }

  if (report.overall === 'degraded') {
    writeStderr('Runtime reconcile degraded. Review warnings above.');
    writeStderr();
  }

  writeStdout('Runtime reconcile passed');
  writeStdout();
}

// Re-export types
export type { RuntimeCheckResult, RuntimeReconcileOptions, RuntimeReport } from './types';
