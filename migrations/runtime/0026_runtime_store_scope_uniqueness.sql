with ranked_workers as (
  select
    ctid,
    row_number() over (
      partition by product_id, coalesce(workspace_id, ''::text), worker_id
      order by updated_at desc, created_at desc, id desc
    ) as duplicate_rank
  from module_worker_registry
)
delete from module_worker_registry
where ctid in (select ctid from ranked_workers where duplicate_rank > 1);

create unique index if not exists module_worker_registry_scope_uidx
  on module_worker_registry (
    product_id,
    (coalesce(workspace_id, ''::text)),
    worker_id
  );

with ranked_catalog as (
  select
    ctid,
    row_number() over (
      partition by product_id, coalesce(workspace_id, ''::text), kind, item_id, version
      order by updated_at desc, created_at desc, id desc
    ) as duplicate_rank
  from module_commercial_catalog
)
delete from module_commercial_catalog
where ctid in (select ctid from ranked_catalog where duplicate_rank > 1);

create unique index if not exists module_commercial_catalog_scope_uidx
  on module_commercial_catalog (
    product_id,
    (coalesce(workspace_id, ''::text)),
    kind,
    item_id,
    version
  );

with ranked_billing_accounts as (
  select
    ctid,
    row_number() over (
      partition by product_id, coalesce(workspace_id, ''::text), user_id
      order by updated_at desc, created_at desc, id desc
    ) as duplicate_rank
  from module_billing_accounts
)
delete from module_billing_accounts
where ctid in (select ctid from ranked_billing_accounts where duplicate_rank > 1);

create unique index if not exists module_billing_accounts_scope_uidx
  on module_billing_accounts (
    product_id,
    (coalesce(workspace_id, ''::text)),
    user_id
  );
