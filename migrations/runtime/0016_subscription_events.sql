create table if not exists module_subscription_events (
  id text primary key,
  product_id text not null,
  workspace_id text,
  user_id text not null,
  subscription_id text not null,
  plan_id text not null,
  type text not null,
  status text not null,
  provider text,
  provider_ref text,
  effective_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists module_subscription_events_lookup_idx
  on module_subscription_events (product_id, workspace_id, user_id, subscription_id, created_at desc);

create index if not exists module_subscription_events_type_idx
  on module_subscription_events (product_id, type, created_at desc);
