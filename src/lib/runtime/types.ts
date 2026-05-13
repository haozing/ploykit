/**
 * Runtime Check Types
 *
 * Structured runtime capability status reporting
 */

export interface RuntimeCheckResult {
  key: string;
  status: 'ok' | 'warning' | 'failed' | 'skipped';
  severity: 'info' | 'warning' | 'error';
  message: string;
  durationMs?: number;
  details?: Record<string, unknown>;
  fix?: string;
}

export interface RuntimeCheck {
  name: string;
  description: string;
  timeoutMs?: number;
  run(): Promise<RuntimeCheckResult> | RuntimeCheckResult;
}

export interface RuntimeReconcileOptions {
  timeoutMs?: number;
}

export interface RuntimeReport {
  timestamp: string;
  environment: string;
  overall: 'ok' | 'degraded' | 'failed';
  checks: RuntimeCheckResult[];
}
