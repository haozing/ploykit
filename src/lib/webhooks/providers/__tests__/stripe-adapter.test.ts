import { describe, expect, it } from 'vitest';

import { StripeWebhookAdapter } from '../stripe-adapter';

const adapter = new StripeWebhookAdapter({
  apiKey: 'sk_test_fake_key',
  webhookSecret: 'whsec_fake',
});

function createSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    current_period_start: 1_700_000_000,
    current_period_end: 1_702_592_000,
    cancel_at_period_end: false,
    metadata: {
      userId: 'user_1',
      planId: 'plan_pro',
    },
    items: {
      data: [
        {
          price: {
            id: 'price_pro_monthly',
            recurring: { interval: 'month' },
          },
        },
      ],
    },
    ...overrides,
  };
}

function createInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'in_1',
    number: 'INV-001',
    subscription: 'sub_1',
    amount_paid: 2500,
    amount_due: 2500,
    currency: 'usd',
    period_start: 1_700_000_000,
    period_end: 1_702_592_000,
    hosted_invoice_url: 'https://stripe.test/invoice/in_1',
    invoice_pdf: 'https://stripe.test/invoice/in_1.pdf',
    status_transitions: {
      paid_at: 1_700_000_030,
    },
    metadata: {},
    subscription_details: {
      metadata: {
        userId: 'user_1',
      },
    },
    lines: {
      data: [
        {
          price: {
            id: 'price_pro_monthly',
            recurring: { interval: 'month' },
          },
        },
      ],
    },
    ...overrides,
  };
}

describe('StripeWebhookAdapter provider event transform', () => {
  it('maps subscription creation to entitlement activation data', async () => {
    const events = await adapter.transform({
      id: 'evt_subscription_created',
      type: 'customer.subscription.created',
      data: {
        object: createSubscription(),
      },
    });

    expect(events).toEqual([
      expect.objectContaining({
        eventName: 'billing.subscription.created',
        userId: 'user_1',
        data: expect.objectContaining({
          subscriptionId: 'sub_1',
          customerId: 'cus_1',
          planId: 'plan_pro',
          stripePriceId: 'price_pro_monthly',
          billingInterval: 'monthly',
          cancelAtPeriodEnd: false,
        }),
      }),
    ]);
  });

  it('maps subscription updates and portal plan changes', async () => {
    const events = await adapter.transform({
      id: 'evt_subscription_updated',
      type: 'customer.subscription.updated',
      data: {
        object: createSubscription({
          metadata: { userId: 'user_1', planId: 'plan_enterprise' },
          items: {
            data: [
              {
                price: {
                  id: 'price_enterprise_yearly',
                  recurring: { interval: 'year' },
                },
              },
            ],
          },
        }),
        previous_attributes: {
          metadata: { planId: 'plan_pro' },
        },
      },
    });

    expect(events).toEqual([
      expect.objectContaining({
        eventName: 'billing.subscription.plan_changed',
        userId: 'user_1',
        data: expect.objectContaining({
          fromPlanId: 'plan_pro',
          toPlanId: 'plan_enterprise',
          stripePriceId: 'price_enterprise_yearly',
          billingInterval: 'yearly',
        }),
      }),
    ]);
  });

  it('accepts both invoice.paid and invoice.payment_succeeded for subscription renewals', async () => {
    for (const type of ['invoice.paid', 'invoice.payment_succeeded']) {
      const events = await adapter.transform({
        id: `evt_${type}`,
        type,
        data: {
          object: createInvoice(),
        },
      });

      expect(events).toEqual([
        expect.objectContaining({
          eventName: 'billing.subscription.renewed',
          userId: 'user_1',
          data: expect.objectContaining({
            subscriptionId: 'sub_1',
            invoiceId: 'in_1',
            invoiceNumber: 'INV-001',
            stripePriceId: 'price_pro_monthly',
            billingInterval: 'monthly',
            amount: 25,
            currency: 'usd',
            hostedInvoiceUrl: 'https://stripe.test/invoice/in_1',
            invoicePdf: 'https://stripe.test/invoice/in_1.pdf',
          }),
        }),
      ]);
    }
  });

  it('maps one-off paid invoices to generic invoice events', async () => {
    const events = await adapter.transform({
      id: 'evt_invoice_paid',
      type: 'invoice.payment_succeeded',
      data: {
        object: createInvoice({
          subscription: null,
          metadata: { userId: 'user_1', checkoutKind: 'one_time_purchase' },
        }),
      },
    });

    expect(events).toEqual([
      expect.objectContaining({
        eventName: 'billing.invoice.paid',
        userId: 'user_1',
        data: expect.objectContaining({
          invoiceId: 'in_1',
          invoiceNumber: 'INV-001',
          amount: 25,
          currency: 'usd',
        }),
      }),
    ]);
  });

  it('maps charge refunds to generic refund events with refund ids', async () => {
    const events = await adapter.transform({
      id: 'evt_refund',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_1',
          amount: 2500,
          amount_refunded: 2500,
          currency: 'usd',
          metadata: {
            userId: 'user_1',
            orderId: 'in_1',
          },
          refunds: {
            data: [
              {
                id: 're_1',
                amount: 2500,
                reason: 'requested_by_customer',
                status: 'succeeded',
              },
            ],
          },
        },
      },
    });

    expect(events).toEqual([
      expect.objectContaining({
        eventName: 'billing.order.refunded',
        userId: 'user_1',
        data: expect.objectContaining({
          orderId: 'in_1',
          chargeId: 'ch_1',
          refundedAmount: 25,
          totalAmount: 25,
          currency: 'usd',
          refunds: [
            {
              id: 're_1',
              amount: 25,
              reason: 'requested_by_customer',
              status: 'succeeded',
            },
          ],
        }),
      }),
    ]);
  });
});
