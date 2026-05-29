alter table module_subscription_events
  add column if not exists idempotency_key text;

create unique index if not exists module_subscription_events_idempotency_uidx
  on module_subscription_events (
    product_id,
    (coalesce(workspace_id, ''::text)),
    idempotency_key
  )
  where idempotency_key is not null;
