create unique index if not exists module_invoices_order_uidx
  on module_invoices (
    product_id,
    (coalesce(workspace_id, ''::text)),
    order_id
  )
  where order_id is not null;

create unique index if not exists module_invoices_number_uidx
  on module_invoices (
    product_id,
    (coalesce(workspace_id, ''::text)),
    number
  );

create unique index if not exists module_credit_notes_provider_ref_uidx
  on module_credit_notes (
    product_id,
    (coalesce(workspace_id, ''::text)),
    provider,
    provider_ref
  )
  where provider_ref is not null;

create unique index if not exists module_credit_notes_number_uidx
  on module_credit_notes (
    product_id,
    (coalesce(workspace_id, ''::text)),
    number
  );
