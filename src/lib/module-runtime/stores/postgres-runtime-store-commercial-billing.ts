import type { ModuleDataPostgresExecutor } from '../data';
import { redactSensitive } from '../observability/redaction';
import type { RuntimeStore } from './runtime-store-types';
import {
  mapBillingAccount,
  mapCreditNote,
  mapInvoice,
  type Row,
} from './postgres-runtime-store-mappers';
import {
  json,
  orderWorkspaceKey,
  runtimeWorkspaceKey,
  toIso,
} from './postgres-runtime-store-utils';

export type PostgresCommercialBillingStore = Pick<
  RuntimeStore,
  | 'upsertBillingAccount'
  | 'getBillingAccount'
  | 'upsertInvoice'
  | 'listInvoices'
  | 'createCreditNote'
  | 'listCreditNotes'
>;

export interface CreatePostgresCommercialBillingStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId: (prefix: string) => string;
}

export function createPostgresCommercialBillingStore(
  options: CreatePostgresCommercialBillingStoreOptions
): PostgresCommercialBillingStore {
  const { database, createId } = options;

  return {
    async upsertBillingAccount(input) {
      const result = await database.query<Row>(
        `insert into module_billing_accounts (
          id, product_id, workspace_id, user_id, status, customer_profile,
          provider_customers, payment_methods, metadata
        )
        values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb)
        on conflict (product_id, (coalesce(workspace_id, ''::text)), user_id)
        do update set
          status = excluded.status,
          customer_profile = module_billing_accounts.customer_profile || excluded.customer_profile,
          provider_customers = module_billing_accounts.provider_customers || excluded.provider_customers,
          payment_methods = excluded.payment_methods,
          metadata = module_billing_accounts.metadata || excluded.metadata,
          updated_at = now()
        returning *`,
        [
          createId('billing_account'),
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.status ?? 'active',
          json(input.customerProfile ?? {}),
          json(input.providerCustomers ?? {}),
          json(input.paymentMethods ?? []),
          json(input.metadata ?? {}),
        ]
      );
      return mapBillingAccount(result.rows[0]!);
    },
    async getBillingAccount(productId, userId, workspaceId) {
      const result = await database.query<Row>(
        `select * from module_billing_accounts
         where product_id = $1
           and user_id = $2
           and coalesce(workspace_id, ''::text) = $3
         limit 1`,
        [productId, userId, runtimeWorkspaceKey(workspaceId)]
      );
      return result.rows[0] ? mapBillingAccount(result.rows[0]) : null;
    },
    async upsertInvoice(input) {
      const workspaceKey = orderWorkspaceKey(input.workspaceId);
      const directExisting = input.id
        ? (await database.query<Row>('select * from module_invoices where id = $1', [input.id]))
            .rows[0]
        : undefined;
      const orderExisting = input.orderId
        ? (
            await database.query<Row>(
              `select *
               from module_invoices
               where product_id = $1
                 and coalesce(workspace_id, ''::text) = $2
                 and order_id = $3
               limit 1`,
              [input.productId, workspaceKey, input.orderId]
            )
          ).rows[0]
        : undefined;
      if (directExisting && orderExisting && directExisting.id !== orderExisting.id) {
        throw new Error(`RUNTIME_STORE_INVOICE_ORDER_CONFLICT: ${input.orderId}`);
      }
      const existing = orderExisting ?? directExisting;
      const id = existing?.id ?? input.id ?? createId('invoice');
      const number =
        input.number ??
        existing?.number ??
        `PK-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${id.slice(-6)}`;
      const numberConflict = await database.query<Row>(
        `select id
         from module_invoices
         where product_id = $1
           and coalesce(workspace_id, ''::text) = $2
           and number = $3
           and id <> $4
         limit 1`,
        [input.productId, workspaceKey, number, id]
      );
      if (numberConflict.rows[0]) {
        throw new Error(`RUNTIME_STORE_INVOICE_NUMBER_CONFLICT: ${number}`);
      }
      const discount = input.discount ?? Number(existing?.discount ?? 0);
      const tax = input.tax ?? Number(existing?.tax ?? 0);
      const total = input.total ?? Math.max(0, input.subtotal - discount + tax);
      const refunded = input.refunded ?? Number(existing?.refunded ?? 0);
      const fee = input.fee ?? Number(existing?.fee ?? 0);
      const result = await database.query<Row>(
        `insert into module_invoices (
          id, product_id, workspace_id, user_id, order_id, subscription_id, number,
          status, subtotal, discount, tax, total, refunded, fee, net, currency,
          provider, provider_ref, document_file_id, tax_snapshot, lines, metadata,
          issued_at, due_at, paid_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20::jsonb, $21::jsonb, $22::jsonb,
          $23::timestamptz, $24::timestamptz, $25::timestamptz
        )
        on conflict (id)
        do update set
          status = excluded.status,
          subtotal = excluded.subtotal,
          discount = excluded.discount,
          tax = excluded.tax,
          total = excluded.total,
          refunded = excluded.refunded,
          fee = excluded.fee,
          net = excluded.net,
          provider = excluded.provider,
          provider_ref = excluded.provider_ref,
          document_file_id = excluded.document_file_id,
          tax_snapshot = excluded.tax_snapshot,
          lines = excluded.lines,
          metadata = module_invoices.metadata || excluded.metadata,
          paid_at = coalesce(excluded.paid_at, module_invoices.paid_at),
          updated_at = now()
        returning *`,
        [
          id,
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.orderId ?? existing?.order_id ?? null,
          input.subscriptionId ?? existing?.subscription_id ?? null,
          number,
          input.status ?? existing?.status ?? 'open',
          input.subtotal,
          discount,
          tax,
          total,
          refunded,
          fee,
          input.net ?? total - refunded - fee,
          input.currency,
          input.provider ?? existing?.provider ?? null,
          input.providerRef ?? existing?.provider_ref ?? null,
          input.documentFileId ?? existing?.document_file_id ?? null,
          json(input.taxSnapshot ?? existing?.tax_snapshot ?? {}),
          json(input.lines ?? existing?.lines ?? []),
          json(input.metadata ?? {}),
          input.issuedAt ?? toIso(existing?.issued_at) ?? new Date().toISOString(),
          input.dueAt ?? toIso(existing?.due_at) ?? null,
          input.paidAt ?? toIso(existing?.paid_at) ?? null,
        ]
      );
      return mapInvoice(result.rows[0]!);
    },
    async listInvoices(query = {}) {
      const result = await database.query<Row>(
        `select * from module_invoices
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = $2)
           and ($3::text is null or user_id = $3)
           and ($4::text is null or order_id = $4)
           and ($5::text is null or status = $5)
         order by created_at desc`,
        [
          query.productId ?? null,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.userId ?? null,
          query.orderId ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapInvoice);
    },
    async createCreditNote(input) {
      const workspaceKey = orderWorkspaceKey(input.workspaceId);
      if (input.provider && input.providerRef) {
        const existing = await database.query<Row>(
          `select *
           from module_credit_notes
           where product_id = $1
             and coalesce(workspace_id, ''::text) = $2
             and provider = $3
             and provider_ref = $4
           limit 1`,
          [input.productId, workspaceKey, input.provider, input.providerRef]
        );
        if (existing.rows[0]) {
          return mapCreditNote(existing.rows[0]);
        }
      }
      const id = input.id ?? createId('credit_note');
      const number =
        input.number ??
        `CN-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${id.slice(-6)}`;
      const numberConflict = await database.query<Row>(
        `select id
         from module_credit_notes
         where product_id = $1
           and coalesce(workspace_id, ''::text) = $2
           and number = $3
           and id <> $4
         limit 1`,
        [input.productId, workspaceKey, number, id]
      );
      if (numberConflict.rows[0]) {
        throw new Error(`RUNTIME_STORE_CREDIT_NOTE_NUMBER_CONFLICT: ${number}`);
      }
      const result = await database.query<Row>(
        `insert into module_credit_notes (
          id, product_id, workspace_id, user_id, order_id, invoice_id, number,
          status, amount, currency, reason, provider, provider_ref, lines, metadata, issued_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16::timestamptz
        )
        on conflict (product_id, (coalesce(workspace_id, ''::text)), provider, provider_ref)
        where provider_ref is not null
        do update set metadata = module_credit_notes.metadata
        returning *`,
        [
          id,
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.orderId ?? null,
          input.invoiceId ?? null,
          number,
          input.status ?? 'issued',
          input.amount,
          input.currency,
          input.reason ?? 'refund',
          input.provider ?? null,
          input.providerRef ?? null,
          json(input.lines ?? []),
          json(redactSensitive(input.metadata ?? {})),
          input.issuedAt ?? new Date().toISOString(),
        ]
      );
      return mapCreditNote(result.rows[0]!);
    },
    async listCreditNotes(query = {}) {
      const result = await database.query<Row>(
        `select * from module_credit_notes
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = $2)
           and ($3::text is null or user_id = $3)
           and ($4::text is null or order_id = $4)
           and ($5::text is null or invoice_id = $5)
           and ($6::text is null or status = $6)
         order by created_at desc`,
        [
          query.productId ?? null,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.userId ?? null,
          query.orderId ?? null,
          query.invoiceId ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapCreditNote);
    },
  };
}
