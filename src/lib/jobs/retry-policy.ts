/**
 * Retry Policy
 *
 * Configurable retry strategies for background jobs.
 */

export interface RetryPolicy {
  maxRetries: number;
  backoff: 'fixed' | 'linear' | 'exponential';
  baseDelayMs: number;
  maxDelayMs: number;
}

export const defaultRetryPolicy: RetryPolicy = {
  maxRetries: 3,
  backoff: 'exponential',
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

export function calculateDelay(attempt: number, policy: RetryPolicy = defaultRetryPolicy): number {
  let delay: number;

  switch (policy.backoff) {
    case 'fixed':
      delay = policy.baseDelayMs;
      break;
    case 'linear':
      delay = policy.baseDelayMs * attempt;
      break;
    case 'exponential':
      delay = policy.baseDelayMs * Math.pow(2, attempt - 1);
      break;
    default:
      delay = policy.baseDelayMs;
  }

  return Math.min(delay, policy.maxDelayMs);
}
