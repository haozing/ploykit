import type {
  RuntimeStore,
  RuntimeStoreCommercialOrder,
  RuntimeStoreCreditNoteRecord,
  RuntimeStoreInvoiceRecord,
  RuntimeStoreRevenueBucket,
} from '../../module-runtime/stores';
import {
  aggregateProvider,
  bucketDate,
  isRevenueInvoice,
  orderInvoiceNumber,
} from './commercial-ledger-utils';
import type { CommercialSkuDefinition } from './commercial-ledger-types';

interface CreateCommercialLedgerFactsInput {
  store: RuntimeStore;
  scope: {
    productId: string;
    workspaceId?: string | null;
  };
  skuCatalog: Record<string, CommercialSkuDefinition>;
  loadInvoiceTaxSnapshot(userId: string, capturedAt: string): Promise<Record<string, unknown>>;
}

export function createCommercialLedgerFacts({
  store,
  scope,
  skuCatalog,
  loadInvoiceTaxSnapshot,
}: CreateCommercialLedgerFactsInput): {
  recordCommercialDomainFacts(order: RuntimeStoreCommercialOrder): Promise<void>;
  recordRefundDomainFacts(input: {
    order: RuntimeStoreCommercialOrder;
    amount: number;
    currency: string;
    provider: string;
    providerRef: string;
    reason: string;
    metadata?: Record<string, unknown>;
  }): Promise<RuntimeStoreCreditNoteRecord>;
  refreshRevenueBucket(date: string, currency: string): Promise<RuntimeStoreRevenueBucket>;
} {
  async function refreshRevenueBucket(
    date: string,
    currency: string
  ): Promise<RuntimeStoreRevenueBucket> {
    const [invoices, creditNotes] = await Promise.all([
      store.listInvoices({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
      }),
      store.listCreditNotes({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
      }),
    ]);
    const bucketInvoices = invoices.filter(
      (invoice) =>
        invoice.currency === currency &&
        isRevenueInvoice(invoice) &&
        bucketDate(invoice.paidAt!) === date
    );
    const bucketCreditNotes = creditNotes.filter(
      (note) =>
        note.currency === currency && note.status === 'issued' && bucketDate(note.issuedAt) === date
    );
    const gross = bucketInvoices.reduce((sum, invoice) => sum + invoice.total, 0);
    const discount = bucketInvoices.reduce((sum, invoice) => sum + invoice.discount, 0);
    const tax = bucketInvoices.reduce((sum, invoice) => sum + invoice.tax, 0);
    const refund = bucketCreditNotes.reduce((sum, note) => sum + note.amount, 0);
    const fee = bucketInvoices.reduce((sum, invoice) => sum + invoice.fee, 0);
    const orders = new Set(bucketInvoices.map((invoice) => invoice.orderId ?? invoice.id)).size;
    return store.upsertRevenueBucket({
      ...scope,
      bucketDate: date,
      currency,
      gross,
      discount,
      tax,
      refund,
      fee,
      net: gross - refund - fee,
      orders,
      provider: aggregateProvider([
        ...bucketInvoices.map((invoice) => invoice.provider),
        ...bucketCreditNotes.map((note) => note.provider),
      ]),
      metadata: {
        source: 'commercial-ledger',
        invoiceCount: bucketInvoices.length,
        creditNoteCount: bucketCreditNotes.length,
      },
    });
  }

  async function recordCommercialDomainFacts(order: RuntimeStoreCommercialOrder): Promise<void> {
    const sku = skuCatalog[order.sku];
    const existingInvoice = (
      await store.listInvoices({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
        orderId: order.id,
      })
    )[0];
    const paidAt = existingInvoice?.paidAt ?? (order.status === 'paid' ? order.updatedAt : null);
    const taxSnapshot = existingInvoice
      ? existingInvoice.taxSnapshot
      : await loadInvoiceTaxSnapshot(order.userId, order.updatedAt);

    await store.upsertBillingAccount({
      ...scope,
      userId: order.userId,
      providerCustomers:
        order.provider && order.providerRef
          ? { [order.provider]: String(order.metadata.customerId ?? order.providerRef) }
          : {},
      paymentMethods: order.provider
        ? [
            {
              id: `${order.provider}:${order.providerRef ?? order.id}`,
              provider: order.provider,
              type: order.provider === 'local' ? 'local' : 'card',
              label:
                order.provider === 'local' ? 'Local ledger checkout' : `${order.provider} checkout`,
              status: 'active',
              updatedAt: order.updatedAt,
            },
          ]
        : undefined,
      metadata: { lastOrderId: order.id, sku: order.sku },
    });

    if (sku?.planId) {
      await store.upsertSubscription({
        ...scope,
        userId: order.userId,
        planId: sku.planId,
        status: order.status === 'paid' ? 'active' : 'past_due',
        provider: order.provider ?? null,
        providerRef: order.providerRef ?? null,
        currentPeriodStart: order.updatedAt,
        renewalStrategy: 'provider',
        metadata: { orderId: order.id, sku: order.sku },
      });
    }

    const invoice = await store.upsertInvoice({
      ...scope,
      id: `invoice-${order.id}`,
      userId: order.userId,
      orderId: order.id,
      subscriptionId: sku?.planId
        ? `${scope.productId}:${scope.workspaceId ?? ''}:${order.userId}:${sku.planId}`
        : null,
      number: orderInvoiceNumber(order),
      status: order.status === 'refunded' ? 'refunded' : order.status === 'paid' ? 'paid' : 'open',
      subtotal: order.amount,
      total: order.amount,
      currency: order.currency,
      provider: order.provider ?? null,
      providerRef: order.providerRef ?? null,
      lines: [
        {
          sku: order.sku,
          quantity: 1,
          amount: order.amount,
          currency: order.currency,
          description: sku?.metadata?.product ?? order.sku,
        },
      ],
      taxSnapshot,
      paidAt,
      metadata: { orderId: order.id },
    });

    if (invoice.paidAt) {
      await refreshRevenueBucket(bucketDate(invoice.paidAt), invoice.currency);
    }
  }

  async function recordRefundDomainFacts(input: {
    order: RuntimeStoreCommercialOrder;
    amount: number;
    currency: string;
    provider: string;
    providerRef: string;
    reason: string;
    metadata?: Record<string, unknown>;
  }): Promise<RuntimeStoreCreditNoteRecord> {
    const invoice = (
      await store.listInvoices({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
        orderId: input.order.id,
      })
    )[0];
    const baseInvoice = await upsertBaseRefundInvoice(input, invoice);
    const creditNote = await store.createCreditNote({
      ...scope,
      userId: input.order.userId,
      orderId: input.order.id,
      invoiceId: baseInvoice.id,
      amount: input.amount,
      currency: input.currency,
      reason: input.reason,
      provider: input.provider,
      providerRef: input.providerRef,
      lines: [
        {
          sku: input.order.sku,
          amount: input.amount,
          currency: input.currency,
        },
      ],
      metadata: {
        orderId: input.order.id,
        invoiceId: baseInvoice.id,
        ...(input.metadata ?? {}),
      },
    });
    const issuedCreditNotes = await store.listCreditNotes({
      productId: scope.productId,
      workspaceId: scope.workspaceId,
      orderId: input.order.id,
      status: 'issued',
    });
    const refunded = issuedCreditNotes
      .filter((note) => note.currency === input.currency)
      .reduce((sum, note) => sum + note.amount, 0);
    const updatedInvoice = await store.upsertInvoice({
      ...scope,
      id: baseInvoice.id,
      userId: input.order.userId,
      orderId: input.order.id,
      subscriptionId: baseInvoice.subscriptionId ?? null,
      number: baseInvoice.number,
      status: refunded >= baseInvoice.total ? 'refunded' : 'paid',
      subtotal: baseInvoice.subtotal,
      discount: baseInvoice.discount,
      tax: baseInvoice.tax,
      total: baseInvoice.total,
      refunded,
      fee: baseInvoice.fee,
      net: baseInvoice.total - refunded - baseInvoice.fee,
      currency: baseInvoice.currency,
      provider: input.provider,
      providerRef: input.providerRef,
      taxSnapshot: baseInvoice.taxSnapshot,
      lines: baseInvoice.lines,
      paidAt: baseInvoice.paidAt ?? input.order.updatedAt,
      metadata: {
        refundedBy: input.provider,
        refundProviderRef: input.providerRef,
        refundReason: input.reason,
      },
    });
    const paidDate = updatedInvoice.paidAt ? bucketDate(updatedInvoice.paidAt) : null;
    const refundDate = bucketDate(creditNote.issuedAt);
    if (paidDate) {
      await refreshRevenueBucket(paidDate, updatedInvoice.currency);
    }
    if (paidDate !== refundDate) {
      await refreshRevenueBucket(refundDate, creditNote.currency);
    }
    return creditNote;
  }

  async function upsertBaseRefundInvoice(
    input: {
      order: RuntimeStoreCommercialOrder;
      amount: number;
      currency: string;
      provider: string;
      providerRef: string;
      reason: string;
      metadata?: Record<string, unknown>;
    },
    invoice: RuntimeStoreInvoiceRecord | undefined
  ): Promise<RuntimeStoreInvoiceRecord> {
    return store.upsertInvoice({
      ...scope,
      id: invoice?.id ?? `invoice-${input.order.id}`,
      userId: input.order.userId,
      orderId: input.order.id,
      subscriptionId: invoice?.subscriptionId ?? null,
      number: invoice?.number,
      status: invoice?.status ?? 'paid',
      subtotal: invoice?.subtotal ?? input.order.amount,
      discount: invoice?.discount ?? 0,
      tax: invoice?.tax ?? 0,
      total: invoice?.total ?? input.order.amount,
      refunded: invoice?.refunded ?? 0,
      fee: invoice?.fee ?? 0,
      net:
        invoice?.net ??
        (invoice?.total ?? input.order.amount) - (invoice?.refunded ?? 0) - (invoice?.fee ?? 0),
      currency: input.currency,
      provider: invoice?.provider ?? input.provider,
      providerRef: invoice?.providerRef ?? input.providerRef,
      taxSnapshot: invoice?.taxSnapshot ?? {},
      lines: invoice?.lines ?? [
        {
          sku: input.order.sku,
          quantity: 1,
          amount: input.order.amount,
          currency: input.currency,
        },
      ],
      paidAt: invoice?.paidAt ?? input.order.updatedAt,
      metadata: {
        orderId: input.order.id,
      },
    });
  }

  return {
    recordCommercialDomainFacts,
    recordRefundDomainFacts,
    refreshRevenueBucket,
  };
}
