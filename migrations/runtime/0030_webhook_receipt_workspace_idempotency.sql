drop index if exists module_webhook_receipts_idempotency_idx;

with ranked_receipts as (
  select
    ctid,
    row_number() over (
      partition by
        product_id,
        coalesce(workspace_id, ''::text),
        module_id,
        webhook_name,
        idempotency_key
      order by updated_at desc, created_at desc, id desc
    ) as duplicate_rank
  from module_webhook_receipts
  where idempotency_key is not null
)
delete from module_webhook_receipts
where ctid in (select ctid from ranked_receipts where duplicate_rank > 1);

create unique index module_webhook_receipts_idempotency_idx
  on module_webhook_receipts (
    product_id,
    (coalesce(workspace_id, ''::text)),
    module_id,
    webhook_name,
    idempotency_key
  )
  where idempotency_key is not null;
