create table if not exists module_provider_invocations (
  id text primary key,
  product_id text not null,
  workspace_id text,
  module_id text,
  provider_id text not null,
  kind text not null,
  operation text not null,
  status text not null,
  target text,
  model text,
  service_connection_id text,
  resource_binding_id text,
  usage jsonb not null default '{}'::jsonb,
  cost jsonb not null default '{}'::jsonb,
  latency_ms integer not null default 0,
  correlation_id text,
  error jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists module_provider_invocations_lookup_idx
  on module_provider_invocations (product_id, workspace_id, module_id, provider_id, kind, status, created_at desc);

create index if not exists module_provider_invocations_connection_idx
  on module_provider_invocations (service_connection_id, created_at desc)
  where service_connection_id is not null;
