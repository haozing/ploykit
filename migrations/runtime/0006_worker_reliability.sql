alter table module_outbox
  add column if not exists scheduled_at timestamptz,
  add column if not exists priority integer not null default 0,
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists heartbeat_at timestamptz;

create index if not exists module_outbox_claim_idx
  on module_outbox (status, priority desc, scheduled_at, created_at);

create index if not exists module_outbox_lease_idx
  on module_outbox (lease_owner, lease_expires_at)
  where lease_owner is not null;
