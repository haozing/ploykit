import { describe, expect, it } from 'vitest';
import {
  sanitizeWebhookHeadersForStorage,
  sanitizeWebhookSignatureForStorage,
} from '../webhook-logger';

describe('webhook logger sanitization', () => {
  it('stores only a hash of webhook signatures', () => {
    const signature = 't=1778162400,v1=secret-signature';
    const stored = sanitizeWebhookSignatureForStorage(signature);

    expect(stored).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(stored).not.toContain(signature);
    expect(stored).not.toContain('secret-signature');
  });

  it('redacts sensitive headers while preserving useful diagnostics', () => {
    const stored = sanitizeWebhookHeadersForStorage({
      'content-type': 'application/json',
      'stripe-signature': 't=1778162400,v1=secret-signature',
      authorization: 'Bearer token',
      'x-request-id': 'req_123',
    });

    expect(stored).toMatchObject({
      'content-type': 'application/json',
      'x-request-id': 'req_123',
    });
    expect(stored?.['stripe-signature']).toMatch(/^\[REDACTED\]:sha256:[a-f0-9]{64}$/);
    expect(stored?.authorization).toMatch(/^\[REDACTED\]:sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain('secret-signature');
    expect(JSON.stringify(stored)).not.toContain('Bearer token');
  });
});
