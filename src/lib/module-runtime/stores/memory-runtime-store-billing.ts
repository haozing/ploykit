import { redactSensitive } from '../observability/redaction';
import type {
  RuntimeStore,
  RuntimeStoreBillingAccount,
  RuntimeStoreCreditNoteRecord,
  RuntimeStoreInvoiceRecord,
} from './runtime-store-types';

type InMemoryBillingRuntimeStore = Pick<
  RuntimeStore,
  | 'upsertBillingAccount'
  | 'getBillingAccount'
  | 'upsertInvoice'
  | 'listInvoices'
  | 'createCreditNote'
  | 'listCreditNotes'
>;

interface CreateInMemoryBillingRuntimeStoreInput {
  now: () => Date;
  createId: (prefix: string) => string;
}

function iso(now: () => Date): string {
  return now().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createInMemoryBillingRuntimeStore({
  now,
  createId,
}: CreateInMemoryBillingRuntimeStoreInput): InMemoryBillingRuntimeStore {
  const billingAccounts = new Map<string, RuntimeStoreBillingAccount>();
  const invoices = new Map<string, RuntimeStoreInvoiceRecord>();
  const creditNotes = new Map<string, RuntimeStoreCreditNoteRecord>();

  return {
    async upsertBillingAccount(input) {
      const key = `${input.productId}:${input.workspaceId ?? ''}:${input.userId}`;
      const existing = billingAccounts.get(key);
      const timestamp = iso(now);
      const account: RuntimeStoreBillingAccount = {
        id: existing?.id ?? createId('billing_account'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        userId: input.userId,
        status: input.status ?? existing?.status ?? 'active',
        customerProfile: { ...(existing?.customerProfile ?? {}), ...(input.customerProfile ?? {}) },
        providerCustomers: {
          ...(existing?.providerCustomers ?? {}),
          ...(input.providerCustomers ?? {}),
        },
        paymentMethods: input.paymentMethods ?? existing?.paymentMethods ?? [],
        metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      billingAccounts.set(key, account);
      return clone(account);
    },
    async getBillingAccount(productId, userId, workspaceId) {
      const account = billingAccounts.get(`${productId}:${workspaceId ?? ''}:${userId}`);
      return account ? clone(account) : null;
    },
    async upsertInvoice(input) {
      const workspaceId = input.workspaceId ?? null;
      const directExisting = input.id ? invoices.get(input.id) : undefined;
      const orderExisting = input.orderId
        ? [...invoices.values()].find(
            (record) =>
              record.productId === input.productId &&
              (record.workspaceId ?? null) === workspaceId &&
              record.orderId === input.orderId
          )
        : undefined;
      if (directExisting && orderExisting && directExisting.id !== orderExisting.id) {
        throw new Error(`RUNTIME_STORE_INVOICE_ORDER_CONFLICT: ${input.orderId}`);
      }
      const existing = orderExisting ?? directExisting;
      const id = existing?.id ?? input.id ?? createId('invoice');
      const timestamp = iso(now);
      const number =
        input.number ??
        existing?.number ??
        `PK-${timestamp.slice(0, 10).replaceAll('-', '')}-${id.slice(-6)}`;
      const numberExisting = [...invoices.values()].find(
        (record) =>
          record.productId === input.productId &&
          (record.workspaceId ?? null) === workspaceId &&
          record.number === number
      );
      if (numberExisting && numberExisting.id !== id) {
        throw new Error(`RUNTIME_STORE_INVOICE_NUMBER_CONFLICT: ${number}`);
      }
      const subtotal = input.subtotal;
      const discount = input.discount ?? existing?.discount ?? 0;
      const tax = input.tax ?? existing?.tax ?? 0;
      const total = input.total ?? Math.max(0, subtotal - discount + tax);
      const refunded = input.refunded ?? existing?.refunded ?? 0;
      const fee = input.fee ?? existing?.fee ?? 0;
      const invoice: RuntimeStoreInvoiceRecord = {
        id,
        productId: input.productId,
        workspaceId,
        userId: input.userId,
        orderId: input.orderId ?? existing?.orderId ?? null,
        subscriptionId: input.subscriptionId ?? existing?.subscriptionId ?? null,
        number,
        status: input.status ?? existing?.status ?? 'open',
        subtotal,
        discount,
        tax,
        total,
        refunded,
        fee,
        net: input.net ?? total - refunded - fee,
        currency: input.currency,
        provider: input.provider ?? existing?.provider ?? null,
        providerRef: input.providerRef ?? existing?.providerRef ?? null,
        documentFileId: input.documentFileId ?? existing?.documentFileId ?? null,
        taxSnapshot: input.taxSnapshot ?? existing?.taxSnapshot ?? {},
        lines: input.lines ?? existing?.lines ?? [],
        metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
        issuedAt: input.issuedAt ?? existing?.issuedAt ?? timestamp,
        dueAt: input.dueAt ?? existing?.dueAt ?? null,
        paidAt: input.paidAt ?? existing?.paidAt ?? null,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      invoices.set(id, invoice);
      return clone(invoice);
    },
    async listInvoices(query = {}) {
      return [...invoices.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.userId || record.userId === query.userId)
        .filter((record) => !query.orderId || record.orderId === query.orderId)
        .filter((record) => !query.status || record.status === query.status)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((record) => clone(record));
    },
    async createCreditNote(input) {
      const workspaceId = input.workspaceId ?? null;
      if (input.provider && input.providerRef) {
        const existing = [...creditNotes.values()].find(
          (record) =>
            record.productId === input.productId &&
            (record.workspaceId ?? null) === workspaceId &&
            record.provider === input.provider &&
            record.providerRef === input.providerRef
        );
        if (existing) {
          return clone(existing);
        }
      }
      const timestamp = iso(now);
      const id = input.id ?? createId('credit_note');
      const number =
        input.number ?? `CN-${timestamp.slice(0, 10).replaceAll('-', '')}-${id.slice(-6)}`;
      const numberExisting = [...creditNotes.values()].find(
        (record) =>
          record.productId === input.productId &&
          (record.workspaceId ?? null) === workspaceId &&
          record.number === number
      );
      if (numberExisting && numberExisting.id !== id) {
        throw new Error(`RUNTIME_STORE_CREDIT_NOTE_NUMBER_CONFLICT: ${number}`);
      }
      const record: RuntimeStoreCreditNoteRecord = {
        id,
        productId: input.productId,
        workspaceId,
        userId: input.userId,
        orderId: input.orderId ?? null,
        invoiceId: input.invoiceId ?? null,
        number,
        status: input.status ?? 'issued',
        amount: input.amount,
        currency: input.currency,
        reason: input.reason ?? 'refund',
        provider: input.provider ?? null,
        providerRef: input.providerRef ?? null,
        lines: input.lines ?? [],
        metadata: redactSensitive(input.metadata ?? {}),
        issuedAt: input.issuedAt ?? timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      creditNotes.set(id, record);
      return clone(record);
    },
    async listCreditNotes(query = {}) {
      return [...creditNotes.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.userId || record.userId === query.userId)
        .filter((record) => !query.orderId || record.orderId === query.orderId)
        .filter((record) => !query.invoiceId || record.invoiceId === query.invoiceId)
        .filter((record) => !query.status || record.status === query.status)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((record) => clone(record));
    },
  };
}
