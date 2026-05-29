export interface SecurityHeadersOptions {
  csp?: string;
  hsts?: boolean | string;
  frameAncestors?: readonly string[];
  permissionsPolicy?: string;
  referrerPolicy?: string;
}

export function createSecurityHeaders(
  options: SecurityHeadersOptions = {}
): Record<string, string> {
  const frameAncestors = options.frameAncestors ?? ["'self'"];
  return {
    'content-security-policy':
      options.csp ??
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        `frame-ancestors ${frameAncestors.join(' ')}`,
      ].join('; '),
    'strict-transport-security':
      typeof options.hsts === 'string'
        ? options.hsts
        : options.hsts === false
          ? ''
          : 'max-age=31536000; includeSubDomains',
    'x-frame-options': frameAncestors.includes("'none'") ? 'DENY' : 'SAMEORIGIN',
    'referrer-policy': options.referrerPolicy ?? 'strict-origin-when-cross-origin',
    'permissions-policy':
      options.permissionsPolicy ?? 'camera=(), microphone=(), geolocation=(), payment=()',
    'x-content-type-options': 'nosniff',
  };
}
