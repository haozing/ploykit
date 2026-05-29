import type { RuntimeStoreOutboxRecord } from '../stores';

export type RuntimeRetryPolicyKind = 'none' | 'fixed' | 'linear' | 'exponential';

export interface RuntimeRetryPolicy {
  id: string;
  kind: RuntimeRetryPolicyKind;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
  retryableErrorPatterns: readonly string[];
  permanentErrorPatterns: readonly string[];
}

export type RuntimeRetryPolicyInput =
  | string
  | Partial<Omit<RuntimeRetryPolicy, 'retryableErrorPatterns' | 'permanentErrorPatterns'>> & {
      retryableErrorPatterns?: readonly string[];
      permanentErrorPatterns?: readonly string[];
    };

const DEFAULT_POLICY: RuntimeRetryPolicy = {
  id: 'fixed',
  kind: 'fixed',
  maxAttempts: 3,
  baseDelayMs: 0,
  maxDelayMs: 30_000,
  jitterMs: 0,
  retryableErrorPatterns: [],
  permanentErrorPatterns: [
    'validation',
    'invalid_payload',
    'permission',
    'unauthorized',
    'forbidden',
    'not_declared',
    'not_found',
    'poison',
  ],
};

export const RUNTIME_RETRY_POLICIES: Record<string, RuntimeRetryPolicy> = {
  none: {
    ...DEFAULT_POLICY,
    id: 'none',
    kind: 'none',
    maxAttempts: 1,
    baseDelayMs: 0,
  },
  fixed: DEFAULT_POLICY,
  linear: {
    ...DEFAULT_POLICY,
    id: 'linear',
    kind: 'linear',
    baseDelayMs: 1000,
    maxDelayMs: 60_000,
  },
  exponential: {
    ...DEFAULT_POLICY,
    id: 'exponential',
    kind: 'exponential',
    baseDelayMs: 1000,
    maxDelayMs: 120_000,
    jitterMs: 0,
  },
};

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), min), max);
}

function patternMatches(patterns: readonly string[], value: string): boolean {
  const normalized = value.toLowerCase();
  return patterns.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === 'string') {
    return error;
  }
  return JSON.stringify(error);
}

export function resolveRuntimeRetryPolicy(
  input: RuntimeRetryPolicyInput | undefined,
  fallbackMaxAttempts: number
): RuntimeRetryPolicy {
  const base =
    typeof input === 'string'
      ? (RUNTIME_RETRY_POLICIES[input] ?? RUNTIME_RETRY_POLICIES.fixed)
      : input?.id
        ? (RUNTIME_RETRY_POLICIES[input.id] ?? RUNTIME_RETRY_POLICIES.fixed)
        : RUNTIME_RETRY_POLICIES.fixed;
  const override = typeof input === 'object' && input ? input : {};
  const maxAttempts = boundedNumber(
    override.maxAttempts,
    fallbackMaxAttempts || base.maxAttempts,
    1,
    100
  );
  const baseDelayMs = boundedNumber(override.baseDelayMs, base.baseDelayMs, 0, 86_400_000);
  const maxDelayMs = boundedNumber(override.maxDelayMs, base.maxDelayMs, baseDelayMs, 86_400_000);
  const jitterMs = boundedNumber(override.jitterMs, base.jitterMs, 0, maxDelayMs);
  return {
    ...base,
    ...override,
    id: override.id ?? base.id,
    kind: override.kind ?? base.kind,
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    jitterMs,
    retryableErrorPatterns: override.retryableErrorPatterns ?? base.retryableErrorPatterns,
    permanentErrorPatterns: override.permanentErrorPatterns ?? base.permanentErrorPatterns,
  };
}

export function classifyRuntimeRetryError(
  error: unknown,
  policy: RuntimeRetryPolicy
): 'retryable' | 'permanent' {
  const text = errorText(error);
  if (patternMatches(policy.permanentErrorPatterns, text)) {
    return 'permanent';
  }
  if (policy.retryableErrorPatterns.length > 0) {
    return patternMatches(policy.retryableErrorPatterns, text) ? 'retryable' : 'permanent';
  }
  return 'retryable';
}

export function runtimeRetryDelayMs(
  policy: RuntimeRetryPolicy,
  attempt: number,
  random: () => number = Math.random
): number {
  if (policy.kind === 'none' || policy.baseDelayMs <= 0) {
    return 0;
  }
  const multiplier =
    policy.kind === 'fixed'
      ? 1
      : policy.kind === 'linear'
        ? Math.max(1, attempt)
        : 2 ** Math.max(0, attempt - 1);
  const jitter = policy.jitterMs > 0 ? Math.floor(random() * policy.jitterMs) : 0;
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * multiplier + jitter);
}

export function retryPolicyFromOutbox(
  record: RuntimeStoreOutboxRecord,
  fallbackMaxAttempts: number
): RuntimeRetryPolicy {
  const metadataPolicy = record.metadata.retryPolicy;
  if (typeof metadataPolicy === 'string' || (metadataPolicy && typeof metadataPolicy === 'object')) {
    return resolveRuntimeRetryPolicy(metadataPolicy as RuntimeRetryPolicyInput, fallbackMaxAttempts);
  }
  return resolveRuntimeRetryPolicy(undefined, fallbackMaxAttempts);
}
