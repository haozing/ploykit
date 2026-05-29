create table if not exists module_host_settings (
  id text primary key,
  product_id text not null,
  workspace_id text,
  namespace text not null,
  key text not null,
  value_json jsonb not null default 'null'::jsonb,
  status text not null default 'active',
  version integer not null default 1,
  updated_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists module_host_settings_lookup_idx
  on module_host_settings (product_id, workspace_id, namespace, key, status, version desc);

create table if not exists module_service_connections (
  connection_id text not null,
  product_id text not null,
  workspace_id text,
  module_id text,
  service text not null,
  provider text not null,
  status text not null default 'active',
  environment text,
  owner_type text,
  scope_type text,
  auth_type text,
  config jsonb not null default '{}'::jsonb,
  secret_refs jsonb not null default '{}'::jsonb,
  health jsonb not null default '{}'::jsonb,
  last_used_at timestamptz,
  updated_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (product_id, connection_id)
);

create index if not exists module_service_connections_lookup_idx
  on module_service_connections (product_id, workspace_id, service, provider, status);

create table if not exists module_resource_bindings (
  binding_id text primary key,
  product_id text not null,
  workspace_id text,
  module_id text,
  name text not null,
  kind text,
  value_json jsonb not null default 'null'::jsonb,
  status text not null default 'active',
  updated_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists module_resource_bindings_lookup_idx
  on module_resource_bindings (product_id, workspace_id, module_id, name, kind, status);
