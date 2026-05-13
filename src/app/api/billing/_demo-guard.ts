import { NotFoundError } from '@/lib/_core/errors';
import { env as appEnv } from '@/lib/_core/env';

type BillingDemoEnv = Pick<typeof appEnv, 'NODE_ENV' | 'BILLING_DEMO_API_ENABLED'>;

export function isBillingDemoApiEnabled(env: BillingDemoEnv = appEnv): boolean {
  return env.NODE_ENV !== 'production' && env.BILLING_DEMO_API_ENABLED === 'true';
}

export function assertBillingDemoApiEnabled(): void {
  if (!isBillingDemoApiEnabled()) {
    throw new NotFoundError('Billing demo API');
  }
}
