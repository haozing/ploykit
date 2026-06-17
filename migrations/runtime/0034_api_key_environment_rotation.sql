alter table module_api_keys
  add column if not exists environment_id text,
  add column if not exists created_by text,
  add column if not exists rate_limit jsonb;

drop index if exists module_api_keys_lookup_idx;

create index if not exists module_api_keys_lookup_idx
  on module_api_keys (
    product_id,
    coalesce(environment_id, ''::text),
    coalesce(workspace_id, ''::text),
    coalesce(module_id, ''::text),
    status
  );
