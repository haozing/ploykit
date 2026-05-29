create table if not exists module_delivery_ledger (
  id text primary key,
  product_id text not null,
  workspace_id text not null default '',
  module_id text,
  actor_id text,
  kind text not null,
  source text not null,
  target text not null,
  status text not null,
  attempts integer not null default 0,
  outbox_id text,
  run_id text,
  receipt_id text,
  event_id text,
  email_id text,
  worker_id text,
  correlation_id text,
  causation_id text,
  next_retry_at timestamptz,
  error_category text,
  error jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists module_delivery_ledger_scope_idx
  on module_delivery_ledger (product_id, workspace_id, module_id, kind, status, created_at desc);

create index if not exists module_delivery_ledger_outbox_idx
  on module_delivery_ledger (outbox_id)
  where outbox_id is not null;

create index if not exists module_delivery_ledger_worker_idx
  on module_delivery_ledger (worker_id, created_at desc)
  where worker_id is not null;

create index if not exists module_delivery_ledger_correlation_idx
  on module_delivery_ledger (correlation_id, created_at desc)
  where correlation_id is not null;

create table if not exists module_worker_registry (
  id text primary key,
  product_id text not null,
  workspace_id text,
  worker_id text not null,
  profile text not null default 'default',
  status text not null default 'running',
  queue_profile text not null default 'default',
  heartbeat_at timestamptz not null default now(),
  last_drain_at timestamptz,
  last_duration_ms integer not null default 0,
  processed integer not null default 0,
  failed integer not null default 0,
  dead_lettered integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, workspace_id, worker_id)
);

create index if not exists module_worker_registry_lookup_idx
  on module_worker_registry (product_id, workspace_id, status, heartbeat_at desc);
