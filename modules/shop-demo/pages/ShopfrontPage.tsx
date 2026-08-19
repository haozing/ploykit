export default function ShopfrontPage(props: { loaderData?: unknown }) {
  const data = asRecord(props.loaderData);
  const products = asRecordList(data?.products);
  return (
    <main className="space-y-6">
      <p className="text-sm font-semibold uppercase text-primary">Shop Demo</p>
      <h1 className="text-3xl font-semibold text-foreground">Shopfront</h1>
      <p className="text-sm leading-6 text-muted-foreground">
        Catalog, coupons, and checkout are served by this module.
      </p>
      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="text-base font-semibold text-foreground">Catalog</h2>
        {products.length > 0 ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product, index) => (
              <article
                key={String(product.id ?? product.slug ?? index)}
                className="rounded-md border border-border p-3"
              >
                <h3 className="font-medium text-foreground">
                  {String(product.title ?? product.slug ?? 'Untitled')}
                </h3>
                {product.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {String(product.description)}
                  </p>
                ) : null}
                {product.price_cents !== undefined ? (
                  <p className="mt-2 text-sm font-semibold text-primary">
                    {String(product.price_cents)} {String(product.currency ?? 'usd')}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {String(data?.emptyState ?? 'No products yet.')}
          </p>
        )}
        {data?.dataState ? (
          <p className="mt-3 text-sm text-destructive">{String(data.dataState)}</p>
        ) : null}
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
