import { describe, expect, it, vi } from 'vitest';

const { applyCreditChangeMock } = vi.hoisted(() => ({
  applyCreditChangeMock: vi.fn(),
}));

vi.mock('@/lib/services/billing/credit-account-service', () => ({
  applyCreditChange: applyCreditChangeMock,
  getUserCreditLedgerBalance: vi.fn(),
}));

import { logSubscriptionDowngrade, logSubscriptionUpgrade } from '../credit-log-service';

describe('credit log service', () => {
  it('preserves subscription upgrade and downgrade credit log types', async () => {
    await logSubscriptionUpgrade({
      userId: 'user-1',
      creditsDelta: 10,
      currentBalance: { 'platform.credits': 20 },
      fromPlan: 'Free',
      toPlan: 'Pro',
      entitlementId: 'ent-1',
    });
    await logSubscriptionDowngrade({
      userId: 'user-1',
      creditsDelta: -5,
      currentBalance: { 'platform.credits': 15 },
      fromPlan: 'Pro',
      toPlan: 'Free',
      entitlementId: 'ent-1',
    });

    expect(applyCreditChangeMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        operation: 'adjust',
        creditLogType: 'subscription_upgrade',
      })
    );
    expect(applyCreditChangeMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        operation: 'adjust',
        creditLogType: 'subscription_downgrade',
      })
    );
  });
});
