create table if not exists module_settlement_batches (
  id text primary key,
  product_id text not null,
  workspace_id text,
  provider text not null,
  currency text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null default 'draft',
  gross integer not null default 0,
  refund integer not null default 0,
  fee integer not null default 0,
  net integer not null default 0,
  order_count integer not null default 0,
  invoice_count integer not null default 0,
  credit_note_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists module_settlement_batches_lookup_idx
  on module_settlement_batches (product_id, workspace_id, provider, currency, status, updated_at desc);

create index if not exists module_settlement_batches_period_idx
  on module_settlement_batches (product_id, provider, period_start, period_end);
