drop index if exists module_commercial_orders_idempotency_idx;
drop index if exists module_commercial_orders_provider_ref_idx;

create unique index module_commercial_orders_idempotency_idx
  on module_commercial_orders (
    product_id,
    (coalesce(workspace_id, ''::text)),
    user_id,
    idempotency_key
  )
  where idempotency_key is not null;

create unique index module_commercial_orders_provider_ref_idx
  on module_commercial_orders (
    product_id,
    (coalesce(workspace_id, ''::text)),
    provider,
    provider_ref
  )
  where provider_ref is not null;
