create table if not exists module_host_users (
  id text primary key,
  email text not null,
  password_hash text not null,
  role text not null,
  status text not null,
  product_id text not null,
  workspace_id text not null,
  workspace_role text not null,
  permissions jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists module_host_users_email_idx
  on module_host_users (lower(email));

create index if not exists module_host_users_scope_idx
  on module_host_users (product_id, workspace_id, role, status);
