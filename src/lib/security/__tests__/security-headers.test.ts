import { describe, expect, it } from 'vitest';
import { NextResponse } from 'next/server';
import { applySecurityHeaders, getSecurityHeaders } from '../security-headers';

describe('security headers', () => {
  it('builds the default security header baseline', () => {
    const headers = getSecurityHeaders({ nodeEnv: 'development' });

    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Content-Security-Policy']).toContain("default-src 'self'");
    expect(headers['Content-Security-Policy']).toContain("'unsafe-inline'");
    expect(headers['Content-Security-Policy']).toContain("'unsafe-eval'");
    expect(headers['Strict-Transport-Security']).toBeUndefined();
  });

  it('adds HSTS in production', () => {
    const headers = getSecurityHeaders({ nodeEnv: 'production' });

    expect(headers['Strict-Transport-Security']).toContain('max-age=31536000');
    expect(headers['Content-Security-Policy']).toContain("'unsafe-inline'");
    expect(headers['Content-Security-Policy']).not.toContain("'unsafe-eval'");
  });

  it('applies headers to a response', () => {
    const response = applySecurityHeaders(NextResponse.json({ ok: true }), {
      nodeEnv: 'development',
    });

    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
  });
});
