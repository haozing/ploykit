import type {
  CommercialSubject,
  ModuleBillingApi,
  ModuleCommerceApi,
  ModuleCreditsApi,
  ModuleEntitlementsApi,
  ModuleMeteringApi,
  ModuleRedeemCodesApi,
} from './context';

function subjectFromInput(input: { subject?: CommercialSubject; userId?: string }): CommercialSubject {
  if (input.subject) {
    return input.subject;
  }
  return { type: 'user', id: input.userId ?? 'test-user' };
}

export function createTestingMeteringApi(moduleId: string): ModuleMeteringApi {
  let nextId = 1;
  const authorization = (
    id: string,
    status: 'authorized' | 'committed' | 'refunded' | 'voided'
  ) => {
    const timestamp = new Date().toISOString();
    return {
      id,
      moduleId,
      meter: 'test',
      quantity: 1,
      status,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  };

  return {
    async authorize(input) {
      const timestamp = new Date().toISOString();
      return {
        id: `test_meter_${nextId++}`,
        moduleId,
        meter: input.meter,
        quantity: input.quantity ?? 1,
        unit: input.unit,
        status: 'authorized',
        idempotencyKey: input.idempotencyKey,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },
    async commit(id) {
      return authorization(id, 'committed');
    },
    async refund(id) {
      return authorization(id, 'refunded');
    },
    async void(id) {
      return authorization(id, 'voided');
    },
    async reconcile() {
      return { checked: 0 };
    },
    async charge(input) {
      const timestamp = new Date().toISOString();
      const id = `test_charge_${nextId++}`;
      return {
        id,
        moduleId,
        subject: input.subject,
        meter: input.meter,
        quantity: input.quantity ?? 1,
        unit: input.unit,
        credits: input.credits
          ? { amount: input.credits.amount, unit: input.credits.unit ?? 'credit' }
          : undefined,
        usageId: `${id}_usage`,
        meteringId: `${id}_metering`,
        balance: input.credits
          ? {
              subject: input.subject,
              userId: input.subject.type === 'user' ? input.subject.id : undefined,
              unit: input.credits.unit ?? 'credit',
              balance: 0,
            }
          : undefined,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
      };
    },
  };
}

export function createTestingCreditsApi(): ModuleCreditsApi {
  return {
    async balance(input: string | { subject: CommercialSubject; unit?: string }, unit = 'credit') {
      if (typeof input === 'string') {
        return { subject: { type: 'user', id: input }, userId: input, unit, balance: 0 };
      }
      return { subject: input.subject, unit: input.unit ?? unit, balance: 0 };
    },
    async grant(input) {
      const subject = subjectFromInput(input);
      return {
        subject,
        userId: subject.type === 'user' ? subject.id : undefined,
        unit: input.unit ?? 'credit',
        balance: input.amount,
      };
    },
    async consume(input) {
      const subject = subjectFromInput(input);
      return {
        subject,
        userId: subject.type === 'user' ? subject.id : undefined,
        unit: input.unit ?? 'credit',
        balance: -input.amount,
      };
    },
    async adjust(input) {
      const subject = subjectFromInput(input);
      return {
        subject,
        userId: subject.type === 'user' ? subject.id : undefined,
        unit: input.unit ?? 'credit',
        balance: input.amount,
      };
    },
    async refund(input) {
      const subject = subjectFromInput(input);
      return {
        subject,
        userId: subject.type === 'user' ? subject.id : undefined,
        unit: input.unit ?? 'credit',
        balance: input.amount,
      };
    },
    async reserve(input) {
      const subject = subjectFromInput(input);
      const timestamp = new Date().toISOString();
      return {
        id: 'test_reservation_1',
        subject,
        amountReserved: input.amount,
        amountCommitted: 0,
        unit: input.unit ?? 'credit',
        status: 'reserved',
        source: input.source,
        sourceId: input.sourceId,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },
    async commitReservation() {
      return {
        subject: { type: 'user', id: 'test-user' },
        userId: 'test-user',
        unit: 'credit',
        balance: 0,
      };
    },
    async releaseReservation() {
      return {
        subject: { type: 'user', id: 'test-user' },
        userId: 'test-user',
        unit: 'credit',
        balance: 0,
      };
    },
    async revokeBySource() {
      return { revoked: 0 };
    },
    async listLedger() {
      return [];
    },
  };
}

export function createTestingBillingApi(): ModuleBillingApi {
  return {
    async getPlan() {
      return null;
    },
    async getCurrentPlan() {
      return null;
    },
    async hasEntitlement() {
      return false;
    },
    async redeemCode() {
      return { ok: false };
    },
  };
}

export function createTestingEntitlementsApi(): ModuleEntitlementsApi {
  return {
    async has() {
      return false;
    },
    async list() {
      return [];
    },
    async grant(input) {
      const subject = subjectFromInput(input);
      const timestamp = new Date().toISOString();
      return {
        id: 'test_entitlement_1',
        subject,
        userId: subject.type === 'user' ? subject.id : undefined,
        entitlement: input.entitlement,
        planId: input.planId,
        source: input.source,
        sourceId: input.sourceId,
        status: 'active',
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },
    async revoke(input) {
      const timestamp = new Date().toISOString();
      return {
        id: input.id,
        subject: { type: 'user', id: 'test-user' },
        userId: 'test-user',
        entitlement: 'test.entitlement',
        source: 'test',
        status: 'revoked',
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },
    async override(input) {
      const timestamp = new Date().toISOString();
      return {
        id: input.id,
        subject: { type: 'user', id: 'test-user' },
        userId: 'test-user',
        entitlement: 'test.entitlement',
        source: 'test',
        status: input.status,
        expiresAt: input.expiresAt ?? undefined,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },
    async expire() {
      return { expired: 0 };
    },
  };
}

export function createTestingCommerceApi(): ModuleCommerceApi {
  return {
    async createCheckout(input) {
      const beneficiary =
        input.beneficiary ?? (input.userId ? { type: 'user' as const, id: input.userId } : undefined);
      return {
        id: 'test_checkout_1',
        userId: input.userId,
        buyer: input.buyer,
        beneficiary,
        sku: input.sku,
        amount: input.amount,
        currency: input.currency,
        status: 'created',
        idempotencyKey: input.idempotencyKey,
        createdAt: new Date().toISOString(),
      };
    },
    async getOrder() {
      return null;
    },
    async applyCheckoutPaid(input) {
      const order = await this.createCheckout(input);
      return { order: { ...order, status: 'paid' }, credits: [], entitlements: [] };
    },
    async applyRefund(input) {
      return {
        order: {
          id: input.orderId ?? 'test_checkout_1',
          sku: 'test',
          amount: input.amount ?? 0,
          currency: input.currency ?? 'usd',
          status: 'refunded',
          createdAt: new Date().toISOString(),
        },
        credits: [],
        revokedEntitlements: [],
      };
    },
    async recordSubscriptionEvent(input) {
      return {
        id: 'test_subscription_event_1',
        subject: input.subject ?? { type: 'user', id: input.userId ?? 'test-user' },
        planId: input.planId,
        type: input.type,
        status: input.status ?? 'active',
      };
    },
    async reconcilePaidOrderBenefits() {
      return { checked: 0, repaired: 0 };
    },
  };
}

export function createTestingRedeemCodesApi(): ModuleRedeemCodesApi {
  return {
    async createBatch(input) {
      const timestamp = new Date().toISOString();
      return {
        batchId: 'test_redeem_batch_1',
        codes: Array.from({ length: input.count }, (_, index) => ({
          id: `test_redeem_code_${index + 1}`,
          batchId: 'test_redeem_batch_1',
          code: `${input.prefix ?? 'TEST'}-${index + 1}`,
          prefix: input.prefix,
          maskedCode: `${input.prefix ?? 'TEST'}-****`,
          entitlement: input.entitlement,
          credits: input.credits,
          maxRedemptions: input.maxRedemptions,
          status: 'active',
          expiresAt: input.expiresAt,
          metadata: input.metadata ?? {},
          createdAt: timestamp,
          updatedAt: timestamp,
        })),
      };
    },
    async redeem(input) {
      const subject = input.subject ?? { type: 'user', id: input.userId ?? 'test-user' };
      return {
        ok: true,
        redemption: {
          id: 'test_redemption_1',
          code: input.code,
          subject,
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata ?? {},
          createdAt: new Date().toISOString(),
        },
      };
    },
    async freeze() {
      return { frozen: 0 };
    },
    async revoke(input) {
      const timestamp = new Date().toISOString();
      return {
        id: input.codeId,
        maxRedemptions: 1,
        status: 'revoked',
        metadata: {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },
    async list() {
      return [];
    },
    async listRedemptions() {
      return [];
    },
  };
}
