/**
 * Log Sanitizer
 *
 * Prevents sensitive information from being logged.
 * Sanitizes common sensitive fields from objects before logging.
 */

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'set-cookie',
  'rawbody',
  'raw_body',
  'body',
  'payload',
  'messagebody',
  'message_body',
  'apiKey',
  'api_key',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'credit_card',
  'cvv',
  'ssn',
]);

const SENSITIVE_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /auth/i,
  /cookie/i,
  /key/i,
  /credential/i,
];

/**
 * Check if a key looks sensitive
 */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_KEYS.has(lower)) return true;
  return SENSITIVE_PATTERNS.some((p) => p.test(key));
}

function isRawPayloadKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.includes('body') || lower.includes('payload');
}

/**
 * Redact a sensitive value
 */
function redact(value: unknown): string {
  if (typeof value === 'string') {
    if (value.length <= 8) return '***';
    return value.slice(0, 3) + '***' + value.slice(-3);
  }
  return '[REDACTED]';
}

export function sanitizeEmail(value: string): string {
  const [localPart, domain] = value.trim().toLowerCase().split('@');

  if (!localPart || !domain) {
    return '[REDACTED_EMAIL]';
  }

  const maskedLocal =
    localPart.length <= 2 ? `${localPart[0] || '*'}***` : `${localPart.slice(0, 2)}***`;

  return `${maskedLocal}@${domain}`;
}

export function sanitizeIp(value: string): string {
  const ip = value.trim();

  if (!ip || ip === 'unknown') {
    return 'unknown';
  }

  if (ip.includes(':')) {
    const segments = ip.split(':').filter(Boolean);
    return segments.length > 0 ? `${segments.slice(0, 2).join(':')}::/32` : '[REDACTED_IP]';
  }

  const segments = ip.split('.');
  if (segments.length === 4) {
    return `${segments[0]}.${segments[1]}.${segments[2]}.0/24`;
  }

  return '[REDACTED_IP]';
}

/**
 * Sanitize an object for logging
 *
 * Recursively traverses objects and redacts sensitive fields.
 */
export function sanitizeForLog<T>(obj: T, depth: number = 0): T {
  if (depth > 5) return '[MAX_DEPTH]' as unknown as T;
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    // Redact email addresses
    if (obj.includes('@') && obj.includes('.')) {
      return sanitizeEmail(obj) as unknown as T;
    }

    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(obj) || /^[0-9a-f:]{3,}$/i.test(obj)) {
      return sanitizeIp(obj) as unknown as T;
    }

    return obj;
  }

  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeForLog(item, depth + 1)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      result[key] = isRawPayloadKey(key) ? '[REDACTED]' : redact(value);
    } else {
      result[key] = sanitizeForLog(value, depth + 1);
    }
  }

  return result as unknown as T;
}

/**
 * Sanitize headers for logging
 */
export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (isSensitiveKey(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = value;
    }
  }
  return result;
}
