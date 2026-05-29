create table if not exists module_api_keys (
  id text primary key,
  product_id text not null,
  workspace_id text,
  module_id text,
  name text not null,
  prefix text not null,
  key_hash text not null,
  owner_subject_type text,
  owner_subject_id text,
  permissions jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists module_api_keys_hash_uidx
  on module_api_keys (key_hash);

create index if not exists module_api_keys_lookup_idx
  on module_api_keys (
    product_id,
    coalesce(workspace_id, ''::text),
    coalesce(module_id, ''::text),
    status
  );

create index if not exists module_api_keys_owner_idx
  on module_api_keys (
    product_id,
    owner_subject_type,
    owner_subject_id
  );
