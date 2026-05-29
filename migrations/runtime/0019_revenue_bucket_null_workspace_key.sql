with ranked_revenue_buckets as (
  select
    ctid,
    row_number() over (
      partition by product_id, coalesce(workspace_id, ''::text), bucket_date, currency
      order by updated_at desc, created_at desc, id desc
    ) as row_number
  from module_revenue_buckets
)
delete from module_revenue_buckets bucket
using ranked_revenue_buckets ranked
where bucket.ctid = ranked.ctid
  and ranked.row_number > 1;

create unique index if not exists module_revenue_buckets_scope_day_currency_uidx
  on module_revenue_buckets (product_id, coalesce(workspace_id, ''::text), bucket_date, currency);
