create table if not exists module_user_identities (
  id text primary key,
  product_id text not null,
  environment_id text,
  user_id text not null,
  provider text not null,
  provider_key text not null,
  email text,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint module_user_identities_user_fk
    foreign key (user_id) references module_host_users (id) on delete cascade
);

create unique index if not exists module_user_identities_provider_key_uidx
  on module_user_identities (
    product_id,
    (coalesce(environment_id, ''::text)),
    provider,
    provider_key
  );

create index if not exists module_user_identities_user_lookup_idx
  on module_user_identities (
    product_id,
    (coalesce(environment_id, ''::text)),
    user_id,
    provider,
    status
  );
