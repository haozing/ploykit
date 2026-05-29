create table if not exists module_credit_reservations (
  id text primary key,
  product_id text not null,
  workspace_id text,
  user_id text not null,
  amount_reserved numeric not null,
  amount_committed numeric not null default 0,
  unit text not null default 'credit',
  status text not null default 'reserved',
  reason text,
  source text,
  source_id text,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists module_credit_reservations_idempotency_idx
  on module_credit_reservations (
    product_id,
    coalesce(workspace_id, ''::text),
    user_id,
    unit,
    idempotency_key
  )
  where idempotency_key is not null;

create index if not exists module_credit_reservations_lookup_idx
  on module_credit_reservations (
    product_id,
    coalesce(workspace_id, ''::text),
    user_id,
    unit,
    status
  );

create index if not exists module_credit_reservations_source_idx
  on module_credit_reservations (
    product_id,
    source,
    source_id
  );
