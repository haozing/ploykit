create table if not exists module_notifications (
  id text primary key,
  product_id text not null,
  workspace_id text,
  module_id text not null,
  user_id text not null,
  channel text not null,
  title text not null,
  body text,
  action_url text,
  run_id text,
  source text not null,
  category text not null,
  status text not null,
  delivery_status text not null,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  read_at timestamptz,
  delivered_at timestamptz,
  skipped_at timestamptz,
  error jsonb
);

create unique index if not exists module_notifications_idempotency_idx
  on module_notifications (product_id, user_id, source, idempotency_key)
  where idempotency_key is not null;

create index if not exists module_notifications_user_idx
  on module_notifications (product_id, workspace_id, user_id, status, created_at desc);

create index if not exists module_notifications_category_idx
  on module_notifications (product_id, category, delivery_status, created_at desc);

create table if not exists module_notification_deliveries (
  id text primary key,
  notification_id text,
  product_id text not null,
  workspace_id text,
  user_id text not null,
  channel text not null,
  provider text not null,
  status text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists module_notification_deliveries_scope_idx
  on module_notification_deliveries (product_id, workspace_id, user_id, status, created_at desc);

create index if not exists module_notification_deliveries_notification_idx
  on module_notification_deliveries (notification_id, created_at desc)
  where notification_id is not null;
