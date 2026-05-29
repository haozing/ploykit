alter table module_webhook_receipts
  add column if not exists headers jsonb not null default '{}'::jsonb,
  add column if not exists body_text text,
  add column if not exists body_digest text;

create index if not exists module_webhook_receipts_body_digest_idx
  on module_webhook_receipts (product_id, module_id, webhook_name, body_digest)
  where body_digest is not null;
