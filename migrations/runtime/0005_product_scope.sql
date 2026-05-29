create table if not exists module_product_scope_products (
  id text primary key,
  name text not null,
  profile text not null,
  default_workspace_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists module_product_scope_workspaces (
  id text primary key,
  product_id text not null,
  name text not null,
  slug text not null,
  domain_aliases jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists module_product_scope_workspaces_slug_idx
  on module_product_scope_workspaces (product_id, slug);

create table if not exists module_product_scope_domain_aliases (
  hostname text primary key,
  product_id text not null,
  workspace_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists module_product_scope_domain_aliases_scope_idx
  on module_product_scope_domain_aliases (product_id, workspace_id);

create table if not exists module_product_scope_invites (
  id text primary key,
  product_id text not null,
  workspace_id text not null,
  email text not null,
  role text not null,
  status text not null,
  token text not null,
  expires_at timestamptz not null,
  invited_by text,
  accepted_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists module_product_scope_invites_token_idx
  on module_product_scope_invites (token);

create index if not exists module_product_scope_invites_scope_idx
  on module_product_scope_invites (product_id, workspace_id, status, expires_at);
