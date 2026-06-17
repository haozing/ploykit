create table if not exists module_rate_limit_events (
  id bigserial primary key,
  bucket text not null,
  cost integer not null default 1,
  occurred_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists module_rate_limit_events_bucket_time_idx
  on module_rate_limit_events (bucket, occurred_at);

create index if not exists module_rate_limit_events_expiry_idx
  on module_rate_limit_events (expires_at);
