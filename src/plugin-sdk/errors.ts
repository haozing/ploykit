export interface PluginErrorOptions {
  code: string;
  message: string;
  statusCode?: number;
  fix?: string;
  details?: Record<string, unknown>;
}

function shouldRedactErrorDetailKey(key: string): boolean {
  const normalized = key.replace(/[-_\s.]/g, '').toLowerCase();

  return [
    'password',
    'passphrase',
    'token',
    'secret',
    'authorization',
    'cookie',
    'setcookie',
    'rawbody',
    'body',
    'payload',
    'messagebody',
    'apikey',
    'accesstoken',
    'refreshtoken',
    'stripe',
    'databaseurl',
    'connectionstring',
  ].some((sensitiveKey) => normalized.includes(sensitiveKey));
}

function removeStackFields(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => removeStackFields(item));
  }

  const result: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    if (key.toLowerCase().includes('stack')) {
      continue;
    }

    result[key] = removeStackFields(nestedValue);
  }

  return result;
}

export function sanitizePluginErrorDetailsForResponse(value: unknown): unknown {
  const stackless = removeStackFields(value);

  if (stackless === null || stackless === undefined || typeof stackless !== 'object') {
    return stackless;
  }

  if (Array.isArray(stackless)) {
    return stackless.map((item) => sanitizePluginErrorDetailsForResponse(item));
  }

  const result: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(stackless)) {
    result[key] = shouldRedactErrorDetailKey(key)
      ? '[REDACTED]'
      : sanitizePluginErrorDetailsForResponse(nestedValue);
  }

  return result;
}

export class PluginError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly fix?: string;
  readonly details?: Record<string, unknown>;

  constructor(options: PluginErrorOptions) {
    super(options.message);
    this.name = 'PluginError';
    this.code = options.code;
    this.statusCode = options.statusCode ?? 400;
    this.fix = options.fix;
    this.details = options.details;
  }

  toJSON() {
    return {
      success: false,
      code: this.code,
      error: {
        name: this.name,
        message: this.message,
        statusCode: this.statusCode,
        fix: this.fix,
        details: this.details
          ? (sanitizePluginErrorDetailsForResponse(this.details) as Record<string, unknown>)
          : undefined,
      },
    };
  }
}
