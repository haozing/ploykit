import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { getApiSecurityDecision } from '../api-security-middleware';

function createRequest(
  pathname: string,
  options: { method?: string; headers?: Record<string, string> } = {}
): NextRequest {
  return new NextRequest(`https://app.example.com${pathname}`, {
    method: options.method || 'POST',
    headers: options.headers,
  });
}

describe('API security middleware', () => {
  it('exempts plugin webhook callbacks from browser CSRF/origin checks', () => {
    const decision = getApiSecurityDecision(createRequest('/api/plugins/demo/webhooks/ingest'), {
      nodeEnv: 'production',
    });

    expect(decision).toEqual({ action: 'allow' });
  });

  it('keeps normal plugin API mutations behind the browser mutation guard', () => {
    const decision = getApiSecurityDecision(createRequest('/api/plugins/demo/tasks'), {
      nodeEnv: 'production',
    });

    expect(decision).toMatchObject({
      action: 'block',
      code: 'ORIGIN_GUARD_DENIED',
    });
  });

  it('does not treat a bare Authorization header as verified machine auth', () => {
    const decision = getApiSecurityDecision(
      createRequest('/api/contact', {
        headers: {
          authorization: 'Bearer forged',
        },
      }),
      {
        nodeEnv: 'production',
        serviceToken: 'real-token',
      }
    );

    expect(decision).toMatchObject({
      action: 'block',
      code: 'ORIGIN_GUARD_DENIED',
    });
  });

  it('allows verified service-token machine auth to bypass browser mutation guards', () => {
    const decision = getApiSecurityDecision(
      createRequest('/api/contact', {
        headers: {
          'x-service-token': 'real-token',
        },
      }),
      {
        nodeEnv: 'production',
        serviceToken: 'real-token',
      }
    );

    expect(decision).toEqual({ action: 'allow' });
  });
});
