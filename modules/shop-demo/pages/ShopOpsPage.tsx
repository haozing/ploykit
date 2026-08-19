export default function ShopOpsPage(props: { loaderData?: unknown }) {
  const data = asRecord(props.loaderData);
  const metrics = asRecord(data?.metrics);
  const products = asRecordList(data?.products);
  const orders = asRecordList(data?.orders);
  return (
    <main className="space-y-6">
      <p className="text-sm font-semibold uppercase text-primary">Shop Ops</p>
      <h1 className="text-3xl font-semibold text-foreground">Shop operations</h1>
      <p className="text-sm leading-6 text-muted-foreground">
        Operate products, coupons, and orders through module APIs and actions.
      </p>
      <section className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
        <p>Products API: /api/modules/shop-demo/products</p>
        <p className="mt-2">Orders API: /api/modules/shop-demo/orders</p>
        <p className="mt-2">Checkout action: checkoutCart</p>
        <p className="mt-2">Data state: {String(data?.dataState ?? 'ready')}</p>
        {data?.message ? <p className="mt-2 text-destructive">Data is currently unavailable.</p> : null}
      </section>
      <section className="grid gap-4 sm:grid-cols-4">
        <Metric label="Products" value={metrics?.products} />
        <Metric label="Orders" value={metrics?.orders} />
        <Metric label="Coupons" value={metrics?.coupons} />
        <Metric label="Revenue" value={metrics?.revenueCents} />
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <List title="Products" items={products} field="title" />
        <List title="Orders" items={orders} field="order_number" />
      </section>
    </main>
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asRecordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)))
    : [];
}

function Metric({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{String(value ?? 0)}</p>
    </div>
  );
}

function List({
  title,
  items,
  field,
}: {
  title: string;
  items: Record<string, unknown>[];
  field: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {items.length > 0 ? (
        <ul className="mt-3 divide-y divide-border text-sm">
          {items.map((item, index) => (
            <li key={String(item.id ?? index)} className="py-3 text-foreground">
              {String(item[field] ?? item.title ?? item.slug ?? 'Unnamed')}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">No {title.toLowerCase()} yet.</p>
      )}
    </div>
  );
}
