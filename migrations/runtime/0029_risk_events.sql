create table if not exists module_risk_events (
  id text primary key,
  product_id text not null,
  workspace_id text,
  module_id text,
  subject_type text,
  subject_id text,
  type text not null,
  severity text not null default 'medium',
  source text,
  source_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists module_risk_blocks (
  id text primary key,
  product_id text not null,
  workspace_id text,
  subject_type text not null,
  subject_id text not null,
  scope text,
  reason text not null,
  expires_at timestamptz,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists module_risk_events_lookup_idx
  on module_risk_events (
    product_id,
    coalesce(workspace_id, ''::text),
    coalesce(module_id, ''::text),
    subject_type,
    subject_id,
    type
  );

create unique index if not exists module_risk_blocks_scope_uidx
  on module_risk_blocks (
    product_id,
    coalesce(workspace_id, ''::text),
    subject_type,
    subject_id,
    coalesce(scope, ''::text)
  );

create index if not exists module_risk_blocks_lookup_idx
  on module_risk_blocks (
    product_id,
    coalesce(workspace_id, ''::text),
    subject_type,
    subject_id
  );
