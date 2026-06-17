create table if not exists module_idempotency_keys (
  id text primary key,
  product_id text not null,
  environment_id text,
  workspace_id text,
  namespace text not null,
  idempotency_key text not null,
  request_hash text not null,
  status text not null check (status in ('in_progress', 'completed')),
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  response_status integer,
  response_headers jsonb,
  response_body_base64 text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists module_idempotency_keys_scope_uidx
  on module_idempotency_keys (
    product_id,
    coalesce(environment_id, ''::text),
    coalesce(workspace_id, ''::text),
    namespace,
    idempotency_key
  );

create index if not exists module_idempotency_keys_lookup_idx
  on module_idempotency_keys (
    product_id,
    coalesce(environment_id, ''::text),
    coalesce(workspace_id, ''::text),
    namespace,
    status,
    expires_at
  );

create index if not exists module_idempotency_keys_locked_idx
  on module_idempotency_keys (status, locked_at)
  where status = 'in_progress';
