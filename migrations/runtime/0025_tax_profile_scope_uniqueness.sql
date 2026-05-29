create unique index if not exists module_tax_profiles_scope_uidx
  on module_tax_profiles (
    product_id,
    (coalesce(workspace_id, ''::text)),
    user_id
  );
