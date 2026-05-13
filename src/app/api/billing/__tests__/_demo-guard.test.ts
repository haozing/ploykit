import { describe, expect, it } from 'vitest';
import { NotFoundError } from '@/lib/_core/errors';
import { assertBillingDemoApiEnabled, isBillingDemoApiEnabled } from '../_demo-guard';

describe('billing demo API guard', () => {
  it('is disabled by default', () => {
    expect(
      isBillingDemoApiEnabled({
        NODE_ENV: 'development',
        BILLING_DEMO_API_ENABLED: 'false',
      })
    ).toBe(false);
  });

  it('requires the explicit demo flag outside production', () => {
    expect(
      isBillingDemoApiEnabled({
        NODE_ENV: 'development',
        BILLING_DEMO_API_ENABLED: 'true',
      })
    ).toBe(true);
  });

  it('stays disabled in production even when the flag is set', () => {
    expect(
      isBillingDemoApiEnabled({
        NODE_ENV: 'production',
        BILLING_DEMO_API_ENABLED: 'true',
      })
    ).toBe(false);
  });

  it('throws 404 when the current process is not explicitly opted in', () => {
    expect(() => assertBillingDemoApiEnabled()).toThrow(NotFoundError);
  });
});
