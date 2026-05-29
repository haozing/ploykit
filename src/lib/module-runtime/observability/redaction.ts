const SENSITIVE_KEY_PATTERN =
  /secret|token|password|passwd|authorization|signature|api[_-]?key|credit[_-]?card|card[_-]?number|private[_-]?key|client[_-]?secret|access[_-]?key/i;
const AUDIT_SENSITIVE_KEY_PATTERN =
  /secret|token|password|passwd|authorization|signature|api[_-]?key|credit[_-]?card|card[_-]?number|private[_-]?key|client[_-]?secret|access[_-]?key|tax[_-]?id|vat[_-]?id|ssn|email|phone|body[_-]?text|raw[_-]?body|request[_-]?body|response[_-]?body|payload|html/i;
const SENSITIVE_NORMALIZED_KEYS = new Set([
  'databaseurl',
  'postgresurl',
  'connectionstring',
  'dsn',
]);

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[\s_-]/g, '').toLowerCase();
  if (normalized.endsWith('configured') || normalized.endsWith('ready')) {
    return false;
  }
  return SENSITIVE_KEY_PATTERN.test(key) || SENSITIVE_NORMALIZED_KEYS.has(normalized);
}

function isAuditSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[\s_-]/g, '').toLowerCase();
  if (normalized.endsWith('configured') || normalized.endsWith('ready')) {
    return false;
  }
  return AUDIT_SENSITIVE_KEY_PATTERN.test(key) || SENSITIVE_NORMALIZED_KEYS.has(normalized);
}

function redactSensitiveString(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+\b/g, '[REDACTED_AUTH]');
}

export function redactSensitive<T = unknown>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item)) as T;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? '[REDACTED]' : redactSensitive(item),
    ])
  ) as T;
}

export function redactAuditMetadata<T = unknown>(value: T): T {
  if (typeof value === 'string') {
    return redactSensitiveString(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactAuditMetadata(item)) as T;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      isAuditSensitiveKey(key) ? '[REDACTED]' : redactAuditMetadata(item),
    ])
  ) as T;
}
