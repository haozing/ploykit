import type { ModuleDataPostgresExecutor } from '../data';
import { redactSensitive } from '../observability/redaction';
import type { RuntimeStore, RuntimeStoreWebhookReceiptStatus } from './runtime-store-types';
import { mapReceipt, type Row } from './postgres-runtime-store-mappers';
import { errorFrom, json } from './postgres-runtime-store-utils';

export type PostgresWebhookStore = Pick<
  RuntimeStore,
  | 'createWebhookReceipt'
  | 'findWebhookReceiptByIdempotencyKey'
  | 'markWebhookReceipt'
  | 'listWebhookReceipts'
>;

export interface CreatePostgresWebhookStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId: (prefix: string) => string;
}

export function createPostgresWebhookStore(
  options: CreatePostgresWebhookStoreOptions
): PostgresWebhookStore {
  const { database, createId } = options;

  return {
    async createWebhookReceipt(input) {
      const result = await database.query<Row>(
        `insert into module_webhook_receipts (
          id, product_id, workspace_id, module_id, webhook_name, path, method,
          status, idempotency_key, signature, headers, body_text, body_digest
        )
        values ($1, $2, $3, $4, $5, $6, $7, 'received', $8, $9, $10::jsonb, $11, $12)
        on conflict (
          product_id,
          (coalesce(workspace_id, ''::text)),
          module_id,
          webhook_name,
          idempotency_key
        )
        where idempotency_key is not null
        do update set updated_at = module_webhook_receipts.updated_at
        returning *`,
        [
          createId('wh'),
          input.productId,
          input.workspaceId ?? null,
          input.moduleId,
          input.webhookName,
          input.path,
          input.method,
          input.idempotencyKey ?? null,
          input.signature ?? null,
          json(redactSensitive(input.headers ?? {})),
          input.bodyText ?? null,
          input.bodyDigest ?? null,
        ]
      );
      return mapReceipt(result.rows[0]!);
    },
    async findWebhookReceiptByIdempotencyKey(
      productId,
      workspaceId,
      moduleId,
      webhookName,
      idempotencyKey
    ) {
      const result = await database.query<Row>(
        `select * from module_webhook_receipts
         where product_id = $1
           and coalesce(workspace_id, ''::text) = coalesce($2::text, ''::text)
           and module_id = $3
           and webhook_name = $4
           and idempotency_key = $5`,
        [productId, workspaceId ?? null, moduleId, webhookName, idempotencyKey]
      );
      return result.rows[0] ? mapReceipt(result.rows[0]) : null;
    },
    async markWebhookReceipt(
      id: string,
      status: RuntimeStoreWebhookReceiptStatus,
      error?: Error | string
    ) {
      const result = await database.query<Row>(
        `update module_webhook_receipts
         set status = $2,
             attempts = case when $2 = 'processing' then attempts + 1 else attempts end,
             processed_at = case when $2 = 'processed' then now() else processed_at end,
             error = $3::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [id, status, json(errorFrom(error))]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_WEBHOOK_RECEIPT_NOT_FOUND: ${id}`);
      }
      return mapReceipt(result.rows[0]);
    },
    async listWebhookReceipts(query = {}) {
      const result = await database.query<Row>(
        `select * from module_webhook_receipts
         where ($1::text is null or product_id = $1)
           and ($2::text is null or module_id = $2)
           and ($3::text is null or status = $3)
         order by created_at desc`,
        [query.productId ?? null, query.moduleId ?? null, query.status ?? null]
      );
      return result.rows.map(mapReceipt);
    },
  };
}
