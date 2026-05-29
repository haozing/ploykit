drop index if exists module_credit_ledger_idempotency_idx;

create unique index module_credit_ledger_idempotency_idx
  on module_credit_ledger (
    product_id,
    (coalesce(workspace_id, ''::text)),
    user_id,
    unit,
    idempotency_key
  )
  where idempotency_key is not null;
