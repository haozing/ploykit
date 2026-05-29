create table if not exists module_credit_notes (
  id text primary key,
  product_id text not null,
  workspace_id text,
  user_id text not null,
  order_id text,
  invoice_id text,
  number text not null,
  status text not null default 'issued',
  amount integer not null,
  currency text not null,
  reason text not null default 'refund',
  provider text,
  provider_ref text,
  lines jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists module_credit_notes_lookup_idx
  on module_credit_notes (product_id, workspace_id, user_id, status, created_at desc);

create index if not exists module_credit_notes_order_idx
  on module_credit_notes (order_id)
  where order_id is not null;

create index if not exists module_credit_notes_invoice_idx
  on module_credit_notes (invoice_id)
  where invoice_id is not null;
