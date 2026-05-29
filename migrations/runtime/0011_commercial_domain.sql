create table if not exists module_commercial_catalog (
  id text primary key,
  product_id text not null,
  workspace_id text,
  kind text not null,
  item_id text not null,
  version integer not null default 1,
  status text not null default 'draft',
  value_json jsonb not null default 'null'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, workspace_id, kind, item_id, version)
);

create index if not exists module_commercial_catalog_lookup_idx
  on module_commercial_catalog (product_id, workspace_id, kind, status, item_id, version desc);

create table if not exists module_billing_accounts (
  id text primary key,
  product_id text not null,
  workspace_id text,
  user_id text not null,
  status text not null default 'active',
  customer_profile jsonb not null default '{}'::jsonb,
  provider_customers jsonb not null default '{}'::jsonb,
  payment_methods jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, workspace_id, user_id)
);

create index if not exists module_billing_accounts_lookup_idx
  on module_billing_accounts (product_id, workspace_id, user_id, status);

create table if not exists module_invoices (
  id text primary key,
  product_id text not null,
  workspace_id text,
  user_id text not null,
  order_id text,
  subscription_id text,
  number text not null,
  status text not null default 'open',
  subtotal numeric not null default 0,
  discount numeric not null default 0,
  tax numeric not null default 0,
  total numeric not null default 0,
  refunded numeric not null default 0,
  fee numeric not null default 0,
  net numeric not null default 0,
  currency text not null,
  provider text,
  provider_ref text,
  document_file_id text,
  tax_snapshot jsonb not null default '{}'::jsonb,
  lines jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  issued_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists module_invoices_lookup_idx
  on module_invoices (product_id, workspace_id, user_id, status, created_at desc);

create index if not exists module_invoices_order_idx
  on module_invoices (order_id)
  where order_id is not null;

create table if not exists module_subscriptions (
  id text primary key,
  product_id text not null,
  workspace_id text,
  user_id text not null,
  plan_id text not null,
  status text not null default 'active',
  provider text,
  provider_ref text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_end timestamptz,
  cancel_at_period_end boolean not null default false,
  renewal_strategy text not null default 'manual',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists module_subscriptions_lookup_idx
  on module_subscriptions (product_id, workspace_id, user_id, plan_id, status);

create table if not exists module_tax_profiles (
  id text primary key,
  product_id text not null,
  workspace_id text,
  user_id text not null,
  status text not null default 'draft',
  jurisdiction text,
  validation_status text not null default 'unverified',
  profile jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, workspace_id, user_id)
);

create index if not exists module_tax_profiles_lookup_idx
  on module_tax_profiles (product_id, workspace_id, user_id, validation_status);

create table if not exists module_revenue_buckets (
  id text primary key,
  product_id text not null,
  workspace_id text,
  bucket_date date not null,
  currency text not null,
  gross numeric not null default 0,
  discount numeric not null default 0,
  tax numeric not null default 0,
  refund numeric not null default 0,
  fee numeric not null default 0,
  net numeric not null default 0,
  orders integer not null default 0,
  provider text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, workspace_id, bucket_date, currency)
);

create index if not exists module_revenue_buckets_lookup_idx
  on module_revenue_buckets (product_id, workspace_id, bucket_date, currency);
