create table if not exists module_files (
  id text primary key,
  product_id text not null,
  workspace_id text,
  module_id text not null,
  owner_id text,
  name text not null,
  purpose text not null,
  status text not null,
  visibility text not null,
  content_type text,
  size_bytes bigint not null default 0,
  checksum text,
  storage_key text not null,
  run_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  published_at timestamptz,
  deleted_at timestamptz,
  quarantined_at timestamptz
);

create index if not exists module_files_scope_idx
  on module_files (product_id, workspace_id, module_id, status, purpose, created_at);

create index if not exists module_files_owner_idx
  on module_files (product_id, owner_id, status, created_at);

create unique index if not exists module_files_storage_key_idx
  on module_files (storage_key);
