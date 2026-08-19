export default function CmsStudioPage(props: { loaderData?: unknown }) {
  const data = asRecord(props.loaderData);
  const metrics = asRecord(data?.metrics);
  const recent = asRecordList(data?.recent);
  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm font-semibold uppercase text-primary">CMS Studio</p>
        <h1 className="mt-2 text-3xl font-semibold text-foreground">Content workspace</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Create drafts, organize categories, and publish content through module APIs and actions.
        </p>
      </header>
      <section className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
        <p>Posts API: /api/modules/cms-demo/posts</p>
        <p className="mt-2">Publish action: publishPost</p>
        <p className="mt-2">Data state: {String(data?.dataState ?? 'ready')}</p>
        {data?.message ? <p className="mt-2 text-destructive">Data is currently unavailable.</p> : null}
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        <Metric label="Drafts" value={metrics?.drafts} />
        <Metric label="Published" value={metrics?.published} />
        <Metric label="Categories" value={metrics?.categories} />
      </section>
      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="text-base font-semibold text-foreground">Recent posts</h2>
        {recent.length > 0 ? (
          <ul className="mt-3 divide-y divide-border text-sm">
            {recent.map((post, index) => (
              <li key={String(post.id ?? post.slug ?? index)} className="py-3">
                <p className="font-medium text-foreground">
                  {String(post.title ?? post.slug ?? 'Untitled')}
                </p>
                <p className="mt-1 text-muted-foreground">{String(post.status ?? 'unknown')}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No recent posts.</p>
        )}
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
