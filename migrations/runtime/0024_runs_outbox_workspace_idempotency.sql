drop index if exists module_runs_idempotency_idx;
drop index if exists module_outbox_idempotency_idx;

create unique index module_runs_idempotency_idx
  on module_runs (
    product_id,
    (coalesce(workspace_id, ''::text)),
    module_id,
    idempotency_key
  )
  where idempotency_key is not null;

create unique index module_outbox_idempotency_idx
  on module_outbox (
    product_id,
    (coalesce(workspace_id, ''::text)),
    name,
    idempotency_key
  )
  where idempotency_key is not null;
