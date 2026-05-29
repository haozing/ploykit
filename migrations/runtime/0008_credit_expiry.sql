alter table module_credit_ledger
  add column if not exists expires_at timestamptz;

create index if not exists module_credit_ledger_expiry_idx
  on module_credit_ledger (product_id, workspace_id, user_id, unit, status, expires_at);
