alter table module_credit_ledger
  add column if not exists environment_id text;

alter table module_credit_reservations
  add column if not exists environment_id text;

drop index if exists module_credit_ledger_idempotency_idx;

create unique index module_credit_ledger_idempotency_idx
  on module_credit_ledger (
    product_id,
    (coalesce(environment_id, ''::text)),
    (coalesce(workspace_id, ''::text)),
    user_id,
    unit,
    idempotency_key
  )
  where idempotency_key is not null;

drop index if exists module_credit_ledger_expiry_idx;

create index module_credit_ledger_expiry_idx
  on module_credit_ledger (
    product_id,
    (coalesce(environment_id, ''::text)),
    (coalesce(workspace_id, ''::text)),
    user_id,
    unit,
    status,
    expires_at
  );

drop index if exists module_credit_reservations_idempotency_idx;

create unique index module_credit_reservations_idempotency_idx
  on module_credit_reservations (
    product_id,
    (coalesce(environment_id, ''::text)),
    (coalesce(workspace_id, ''::text)),
    user_id,
    unit,
    idempotency_key
  )
  where idempotency_key is not null;

drop index if exists module_credit_reservations_lookup_idx;

create index module_credit_reservations_lookup_idx
  on module_credit_reservations (
    product_id,
    (coalesce(environment_id, ''::text)),
    (coalesce(workspace_id, ''::text)),
    user_id,
    unit,
    status
  );

drop index if exists module_credit_reservations_expiry_idx;

create index module_credit_reservations_expiry_idx
  on module_credit_reservations (
    product_id,
    (coalesce(environment_id, ''::text)),
    (coalesce(workspace_id, ''::text)),
    status,
    expires_at
  );

alter table module_risk_events
  add column if not exists status text not null default 'open',
  add column if not exists acknowledged_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists ignored_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table module_risk_blocks
  add column if not exists released_at timestamptz,
  add column if not exists released_by text,
  add column if not exists release_reason text;

drop index if exists module_risk_blocks_scope_uidx;

create unique index module_risk_blocks_scope_uidx
  on module_risk_blocks (
    product_id,
    (coalesce(workspace_id, ''::text)),
    subject_type,
    subject_id,
    (coalesce(scope, ''::text))
  )
  where released_at is null;

drop index if exists module_risk_blocks_lookup_idx;

create index module_risk_blocks_lookup_idx
  on module_risk_blocks (
    product_id,
    (coalesce(workspace_id, ''::text)),
    subject_type,
    subject_id,
    released_at
  );
