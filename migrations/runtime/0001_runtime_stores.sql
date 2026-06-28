create table if not exists module_runs (
  id text primary key,
  product_id text not null,
  workspace_id text,
  module_id text not null,
  kind text not null,
  name text not null,
  status text not null,
  progress integer not null default 0,
  attempt integer not null default 0,
  max_attempts integer not null default 1,
  input jsonb,
  result jsonb,
  error jsonb,
  cost_ref text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  cancel_requested_at timestamptz,
  canceled_at timestamptz
);

create unique index if not exists module_runs_idempotency_idx
  on module_runs (product_id, module_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists module_runs_scope_idx
  on module_runs (product_id, workspace_id, module_id, status);

create table if not exists module_run_logs (
  id bigserial primary key,
  run_id text not null references module_runs(id) on delete cascade,
  at timestamptz not null default now(),
  level text not null,
  message text not null,
  metadata jsonb
);

create index if not exists module_run_logs_run_idx
  on module_run_logs (run_id, at);

create table if not exists module_outbox (
  id text primary key,
  product_id text not null,
  workspace_id text,
  module_id text,
  name text not null,
  payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  status text not null,
  attempts integer not null default 0,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  error jsonb
);

create unique index if not exists module_outbox_idempotency_idx
  on module_outbox (product_id, name, idempotency_key)
  where idempotency_key is not null;

create index if not exists module_outbox_pending_idx
  on module_outbox (status, created_at);

create table if not exists module_webhook_receipts (
  id text primary key,
  product_id text not null,
  workspace_id text,
  module_id text not null,
  webhook_name text not null,
  path text not null,
  method text not null,
  status text not null,
  attempts integer not null default 0,
  idempotency_key text,
  signature text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  error jsonb
);

create unique index if not exists module_webhook_receipts_idempotency_idx
  on module_webhook_receipts (product_id, module_id, webhook_name, idempotency_key)
  where idempotency_key is not null;

create index if not exists module_webhook_receipts_status_idx
  on module_webhook_receipts (product_id, module_id, status, created_at);

create table if not exists module_audit_logs (
  id text primary key,
  product_id text not null,
  workspace_id text,
  module_id text,
  actor_id text,
  type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists module_audit_logs_scope_idx
  on module_audit_logs (product_id, workspace_id, module_id, type, created_at);

create table if not exists module_usage_records (
  id text primary key,
  product_id text not null,
  workspace_id text,
  module_id text not null,
  meter text not null,
  quantity numeric not null default 1,
  unit text,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists module_usage_records_idempotency_idx
  on module_usage_records (product_id, module_id, meter, idempotency_key)
  where idempotency_key is not null;

create table if not exists module_metering_ledger (
  id text primary key,
  product_id text not null,
  workspace_id text,
  module_id text not null,
  meter text not null,
  quantity numeric not null,
  unit text,
  status text not null,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists module_metering_ledger_idempotency_idx
  on module_metering_ledger (product_id, module_id, meter, idempotency_key)
  where idempotency_key is not null;

create table if not exists module_credit_ledger (
  id text primary key,
  product_id text not null,
  workspace_id text,
  user_id text not null,
  amount numeric not null,
  unit text not null,
  reason text not null,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists module_credit_ledger_idempotency_idx
  on module_credit_ledger (product_id, user_id, unit, idempotency_key)
  where idempotency_key is not null;

create table if not exists module_catalog_states (
  product_id text not null,
  module_id text not null,
  status text not null,
  bundle_id text,
  required boolean not null default false,
  scope_profile text,
  trust text not null default 'product',
  allowed_provides jsonb not null default '[]'::jsonb,
  diagnostics jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (product_id, module_id)
);

create table if not exists module_product_scope_memberships (
  id text primary key,
  product_id text not null,
  workspace_id text not null,
  user_id text not null,
  role text not null,
  status text not null,
  updated_at timestamptz not null default now()
);

create unique index if not exists module_product_scope_memberships_unique_idx
  on module_product_scope_memberships (product_id, workspace_id, user_id);
