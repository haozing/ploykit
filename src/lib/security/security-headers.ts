/**
 * Unified security response headers.
 *
 * This module stays edge-safe so the global Next proxy can apply the same
 * baseline as server route wrappers.
 */

import { buildCSPHeader, createCSPPolicy } from './csp-policy.server';
import { readProxyRuntimeEnv } from './proxy-runtime-env';

export interface SecurityHeaders {
  'Content-Security-Policy'?: string;
  'X-Content-Type-Options': string;
  'Referrer-Policy': string;
  'X-Frame-Options'?: string;
  'Strict-Transport-Security'?: string;
  'Permissions-Policy'?: string;
}

export interface SecurityHeaderOptions {
  nodeEnv?: string;
  includeCsp?: boolean;
}

/**
 * Get default security headers.
 */
export function getSecurityHeaders(options: SecurityHeaderOptions = {}): SecurityHeaders {
  const nodeEnv = options.nodeEnv || readProxyRuntimeEnv().nodeEnv;
  const includeCsp = options.includeCsp ?? true;

  const headers: SecurityHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'X-Frame-Options': 'DENY',
  };

  if (includeCsp) {
    if (nodeEnv === 'development') {
      const policy = createCSPPolicy({
        trustLevel: 'trusted',
        pluginSources: ['ws:', 'http://localhost:3000', 'http://localhost:3001'],
      });
      policy.directives['script-src'] = [
        ...new Set([
          ...(policy.directives['script-src'] || ["'self'"]),
          "'unsafe-eval'",
          "'wasm-unsafe-eval'",
        ]),
      ];
      headers['Content-Security-Policy'] = buildCSPHeader(policy);
    } else {
      const policy = createCSPPolicy({ trustLevel: 'default' });
      // Next.js emits inline bootstrap scripts/styles in production unless full per-request
      // nonce plumbing is wired through the proxy and rendered markup.
      policy.directives['script-src'] = [
        ...new Set([...(policy.directives['script-src'] || ["'self'"]), "'unsafe-inline'"]),
      ];
      policy.directives['style-src'] = [
        ...new Set([...(policy.directives['style-src'] || ["'self'"]), "'unsafe-inline'"]),
      ];
      headers['Content-Security-Policy'] = buildCSPHeader(policy);
    }
  }

  if (nodeEnv === 'production') {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload';
  }

  return headers;
}

/**
 * Apply security headers to a Response/NextResponse.
 */
export function applySecurityHeaders<T extends Response>(
  response: T,
  options: SecurityHeaderOptions = {}
): T {
  const headers = getSecurityHeaders(options);

  for (const [key, value] of Object.entries(headers)) {
    if (value) {
      response.headers.set(key, value);
    }
  }

  return response;
}
