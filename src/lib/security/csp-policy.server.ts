/**
 * CSP Policy Builder
 *
 * Generates Content-Security-Policy headers that can be extended by plugins.
 * Ensures CSP, plugin head tags, and global slots share the same policy decision.
 *
 * Design:
 * - Base policy is restrictive
 * - Plugins can declare allowed sources in the runtime contract
 * - Nonce support for inline scripts/styles from trusted plugins
 * - External sources must match allowlist
 */

import { readProxyRuntimeEnv } from './proxy-runtime-env';

export type CSPDirective =
  | 'default-src'
  | 'script-src'
  | 'style-src'
  | 'img-src'
  | 'font-src'
  | 'connect-src'
  | 'media-src'
  | 'object-src'
  | 'frame-src'
  | 'frame-ancestors'
  | 'base-uri'
  | 'form-action'
  | 'worker-src'
  | 'manifest-src'
  | 'upgrade-insecure-requests'
  | 'block-all-mixed-content';

export interface CSPPolicy {
  /** Map of directive to allowed sources */
  directives: Partial<Record<CSPDirective, string[]>>;
  /** Nonce for inline scripts/styles (generated per request) */
  nonce?: string;
}

/**
 * Generate a cryptographically secure nonce
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Default restrictive base policy
 */
export function getBasePolicy(): CSPPolicy {
  return {
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'"],
      'img-src': ["'self'", 'data:', 'https:'],
      'font-src': ["'self'"],
      'connect-src': ["'self'"],
      'media-src': ["'self'"],
      'object-src': ["'none'"],
      'frame-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'worker-src': ["'self'"],
      'manifest-src': ["'self'"],
    },
  };
}

/**
 * Merge plugin-declared sources into the policy
 *
 * Plugins declare egress sources in plugin.ts:
 * ```ts
 * definePlugin({
 *   egress: ['https://api.example.com', 'wss://socket.example.com'],
 * })
 * ```
 */
export function mergePluginEgress(policy: CSPPolicy, allowedSources: string[]): CSPPolicy {
  if (!allowedSources.length) return policy;

  const newPolicy: CSPPolicy = {
    directives: { ...policy.directives },
    nonce: policy.nonce,
  };

  // Plugin egress affects connect-src and potentially script-src/frame-src
  const connectSrc = new Set(newPolicy.directives['connect-src'] || ["'self'"]);
  for (const src of allowedSources) {
    // Validate source format
    if (isValidSource(src)) {
      connectSrc.add(src);
    }
  }
  newPolicy.directives['connect-src'] = [...connectSrc];

  return newPolicy;
}

/**
 * Apply nonce to script-src and style-src for inline content
 */
export function applyNonce(policy: CSPPolicy, nonce: string): CSPPolicy {
  const newPolicy: CSPPolicy = {
    directives: { ...policy.directives },
    nonce,
  };

  // Add nonce to script-src
  const scriptSrc = new Set(newPolicy.directives['script-src'] || ["'self'"]);
  scriptSrc.add(`'nonce-${nonce}'`);
  // Remove 'unsafe-inline' if nonce is present (browsers ignore unsafe-inline when nonce is set)
  scriptSrc.delete("'unsafe-inline'");
  newPolicy.directives['script-src'] = [...scriptSrc];

  // Add nonce to style-src
  const styleSrc = new Set(newPolicy.directives['style-src'] || ["'self'"]);
  styleSrc.add(`'nonce-${nonce}'`);
  styleSrc.delete("'unsafe-inline'");
  newPolicy.directives['style-src'] = [...styleSrc];

  return newPolicy;
}

/**
 * Build CSP header string from policy
 */
export function buildCSPHeader(policy: CSPPolicy): string {
  const parts: string[] = [];

  for (const [directive, sources] of Object.entries(policy.directives)) {
    if (sources && sources.length > 0) {
      parts.push(`${directive} ${sources.join(' ')}`);
    }
  }

  return parts.join('; ');
}

/**
 * Validate a CSP source string
 */
function isValidSource(source: string): boolean {
  // Allow common CSP source values
  if (
    [
      "'self'",
      "'none'",
      "'unsafe-inline'",
      "'unsafe-eval'",
      "'wasm-unsafe-eval'",
      "'strict-dynamic'",
      '*',
      'data:',
      'blob:',
      'filesystem:',
    ].includes(source)
  ) {
    return true;
  }

  // Validate URL format
  try {
    const url = new URL(source);
    // Only allow https: in production, allow http: in development.
    // Keep this edge-safe: proxy/security header code can import the policy builder.
    if (
      readProxyRuntimeEnv().nodeEnv === 'production' &&
      url.protocol !== 'https:' &&
      url.protocol !== 'wss:'
    ) {
      return false;
    }
    return true;
  } catch {
    // Might be a scheme-source like https: or ws:
    if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) {
      return true;
    }
    return false;
  }
}

/**
 * Create a full CSP policy for a request
 *
 * @param options.pluginSources - Plugin-declared egress sources
 * @param options.useNonce - Whether to generate and apply a nonce
 * @param options.trustLevel - 'strict' | 'default' | 'trusted' affects base policy strictness
 */
export function createCSPPolicy(
  options: {
    pluginSources?: string[];
    useNonce?: boolean;
    trustLevel?: 'strict' | 'default' | 'trusted';
  } = {}
): CSPPolicy {
  const { pluginSources = [], useNonce = false, trustLevel = 'default' } = options;

  let policy = getBasePolicy();

  // Adjust base policy by trust level
  if (trustLevel === 'trusted') {
    // Trusted plugins can have slightly relaxed defaults
    policy.directives['script-src'] = ["'self'", "'unsafe-inline'"];
    policy.directives['style-src'] = ["'self'", "'unsafe-inline'"];
  } else if (trustLevel === 'strict') {
    // Strict mode: no inline anything
    policy.directives['script-src'] = ["'self'"];
    policy.directives['style-src'] = ["'self'"];
  }

  // Merge plugin egress
  if (pluginSources.length > 0) {
    policy = mergePluginEgress(policy, pluginSources);
  }

  // Apply nonce if requested
  if (useNonce) {
    const nonce = generateNonce();
    policy = applyNonce(policy, nonce);
  }

  return policy;
}

/**
 * Get CSP header string for a request
 *
 * Convenience function for route handlers
 */
export function getCSPHeader(options?: {
  pluginSources?: string[];
  useNonce?: boolean;
  trustLevel?: 'strict' | 'default' | 'trusted';
}): string {
  return buildCSPHeader(createCSPPolicy(options));
}
