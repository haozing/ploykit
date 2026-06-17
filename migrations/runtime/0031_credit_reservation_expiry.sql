alter table module_credit_reservations
  add column if not exists expires_at timestamptz;

create index if not exists module_credit_reservations_expiry_idx
  on module_credit_reservations (
    product_id,
    coalesce(workspace_id, ''::text),
    status,
    expires_at
  )
  where status = 'reserved' and expires_at is not null;
