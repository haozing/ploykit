alter table module_credit_ledger
  add column if not exists status text not null default 'available';

create table if not exists module_commercial_entitlements (
  id text primary key,
  product_id text not null,
  workspace_id text,
  user_id text not null,
  entitlement text not null,
  plan_id text,
  source text not null,
  status text not null,
  idempotency_key text,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists module_commercial_entitlements_idempotency_idx
  on module_commercial_entitlements (product_id, user_id, entitlement, idempotency_key)
  where idempotency_key is not null;

create index if not exists module_commercial_entitlements_lookup_idx
  on module_commercial_entitlements (product_id, workspace_id, user_id, entitlement, status);

create table if not exists module_commercial_orders (
  id text primary key,
  product_id text not null,
  workspace_id text,
  user_id text not null,
  sku text not null,
  amount numeric not null,
  currency text not null,
  status text not null,
  provider text,
  provider_ref text,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists module_commercial_orders_idempotency_idx
  on module_commercial_orders (product_id, user_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists module_commercial_orders_provider_ref_idx
  on module_commercial_orders (product_id, provider, provider_ref)
  where provider_ref is not null;

create index if not exists module_commercial_orders_lookup_idx
  on module_commercial_orders (product_id, workspace_id, user_id, status, created_at);

create table if not exists module_redeem_codes (
  product_id text not null,
  code text not null,
  entitlement text,
  credits_amount numeric,
  credits_unit text not null default 'credit',
  max_redemptions integer not null default 1,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (product_id, code)
);

create table if not exists module_redeem_redemptions (
  id text primary key,
  product_id text not null,
  code text not null,
  user_id text not null,
  entitlement text,
  credits_amount numeric,
  credits_unit text,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists module_redeem_redemptions_user_code_idx
  on module_redeem_redemptions (product_id, code, user_id);

create unique index if not exists module_redeem_redemptions_idempotency_idx
  on module_redeem_redemptions (product_id, user_id, idempotency_key)
  where idempotency_key is not null;
