create table if not exists module_runtime_migrations (
  id text primary key,
  checksum text not null,
  applied_at timestamptz,
  duration_ms integer,
  status text not null,
  environment text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
