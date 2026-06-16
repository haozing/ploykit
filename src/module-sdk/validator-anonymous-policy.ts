import { createModuleDiagnostic, type ModuleDiagnostic } from './diagnostics';
import type { ModuleApiRoute } from './types';

const RATE_LIMIT_WINDOW_PATTERN = /^\d+(ms|s|m|h|d)$/;
const ANONYMOUS_POLICY_CAPTCHAS = new Set(['never', 'auto', 'always']);

function addError(
  diagnostics: ModuleDiagnostic[],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  diagnostics.push(createModuleDiagnostic({ code, severity: 'error', message, path, fix }));
}

export function validateAnonymousPolicy(
  diagnostics: ModuleDiagnostic[],
  route: ModuleApiRoute,
  path: string
): void {
  const policy = route.anonymousPolicy;
  if (!policy) {
    return;
  }

  if (!policy.rateLimit) {
    addError(
      diagnostics,
      'MODULE_PUBLIC_API_RATE_LIMIT_REQUIRED',
      'Public API routes must declare anonymousPolicy.rateLimit.',
      `${path}.anonymousPolicy.rateLimit`,
      'Add an IP, route, module, method, or custom bucket rate limit.'
    );
  } else {
    if (!Number.isInteger(policy.rateLimit.limit) || policy.rateLimit.limit <= 0) {
      addError(
        diagnostics,
        'MODULE_PUBLIC_API_RATE_LIMIT_INVALID',
        'anonymousPolicy.rateLimit.limit must be a positive integer.',
        `${path}.anonymousPolicy.rateLimit.limit`
      );
    }

    if (!RATE_LIMIT_WINDOW_PATTERN.test(policy.rateLimit.window)) {
      addError(
        diagnostics,
        'MODULE_PUBLIC_API_RATE_LIMIT_WINDOW_INVALID',
        'anonymousPolicy.rateLimit.window must use a duration such as "30s", "1m", or "1h".',
        `${path}.anonymousPolicy.rateLimit.window`
      );
    }
  }

  if (
    policy.maxUploadBytes !== undefined &&
    (!Number.isInteger(policy.maxUploadBytes) || policy.maxUploadBytes <= 0)
  ) {
    addError(
      diagnostics,
      'MODULE_PUBLIC_API_UPLOAD_LIMIT_INVALID',
      'anonymousPolicy.maxUploadBytes must be a positive integer when declared.',
      `${path}.anonymousPolicy.maxUploadBytes`
    );
  }

  if (policy.captcha && !ANONYMOUS_POLICY_CAPTCHAS.has(policy.captcha)) {
    addError(
      diagnostics,
      'MODULE_PUBLIC_API_CAPTCHA_INVALID',
      `Anonymous captcha policy "${policy.captcha}" is not supported.`,
      `${path}.anonymousPolicy.captcha`,
      'Use "never", "auto", or "always".'
    );
  }

  if (route.commercial && policy.allowHighCostActions === true) {
    addError(
      diagnostics,
      'MODULE_PUBLIC_API_HIGH_COST_ANONYMOUS_FORBIDDEN',
      'Public commercial API routes cannot allow anonymous high-cost actions.',
      `${path}.anonymousPolicy.allowHighCostActions`,
      'Set allowHighCostActions: false and require auth for high-cost execution.'
    );
  }
}
