create table if not exists module_platform_users (
  id text primary key,
  email text not null,
  display_name text,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists module_platform_users_email_uidx
  on module_platform_users (lower(email));

create index if not exists module_platform_users_status_idx
  on module_platform_users (status, created_at);

create table if not exists module_workspace_members (
  id text primary key,
  product_id text not null,
  workspace_id text not null,
  platform_user_id text not null,
  role text not null,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint module_workspace_members_platform_user_fk
    foreign key (platform_user_id) references module_platform_users (id) on delete cascade
);

create unique index if not exists module_workspace_members_scope_uidx
  on module_workspace_members (product_id, workspace_id, platform_user_id);

create index if not exists module_workspace_members_lookup_idx
  on module_workspace_members (product_id, workspace_id, status, role);

create table if not exists module_workspace_invites (
  id text primary key,
  product_id text not null,
  workspace_id text not null,
  email text not null,
  role text not null,
  status text not null default 'pending',
  token_hash text not null,
  invited_by_platform_user_id text,
  accepted_by_platform_user_id text,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint module_workspace_invites_invited_by_fk
    foreign key (invited_by_platform_user_id) references module_platform_users (id) on delete set null,
  constraint module_workspace_invites_accepted_by_fk
    foreign key (accepted_by_platform_user_id) references module_platform_users (id) on delete set null
);

create unique index if not exists module_workspace_invites_token_uidx
  on module_workspace_invites (token_hash);

create index if not exists module_workspace_invites_scope_idx
  on module_workspace_invites (product_id, workspace_id, status, expires_at);

create table if not exists module_auth_sessions (
  id text primary key,
  product_id text not null,
  environment_id text,
  workspace_id text,
  subject_type text not null,
  subject_id text not null,
  device_id text,
  session_type text not null default 'browser',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists module_auth_sessions_subject_idx
  on module_auth_sessions (
    product_id,
    (coalesce(environment_id, ''::text)),
    (coalesce(workspace_id, ''::text)),
    subject_type,
    subject_id,
    status,
    last_seen_at
  );

create index if not exists module_auth_sessions_status_idx
  on module_auth_sessions (status, expires_at, revoked_at);
