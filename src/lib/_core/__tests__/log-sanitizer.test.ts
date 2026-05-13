import { describe, expect, it } from 'vitest';
import { sanitizeEmail, sanitizeForLog, sanitizeHeaders, sanitizeIp } from '../log-sanitizer';

describe('log sanitizer', () => {
  it('redacts sensitive headers', () => {
    expect(
      sanitizeHeaders({
        authorization: 'Bearer secret-token',
        cookie: 'session=secret',
        'x-request-id': 'req_123',
      })
    ).toEqual({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      'x-request-id': 'req_123',
    });
  });

  it('masks email and IP values', () => {
    expect(sanitizeEmail('Person@example.com')).toBe('pe***@example.com');
    expect(sanitizeIp('203.0.113.24')).toBe('203.0.113.0/24');
    expect(sanitizeIp('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8::/32');
  });

  it('redacts raw bodies and nested secrets', () => {
    const sanitized = sanitizeForLog({
      email: 'person@example.com',
      rawBody: '{"password":"secret"}',
      nested: {
        apiKey: 'sk_test_secret',
        ip: '203.0.113.24',
      },
    });

    expect(sanitized).toEqual({
      email: 'pe***@example.com',
      rawBody: '[REDACTED]',
      nested: {
        apiKey: 'sk_***ret',
        ip: '203.0.113.0/24',
      },
    });
  });
});
