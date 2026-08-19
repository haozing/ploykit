export default function PublicCmsPage(props: { loaderData?: unknown }) {
  const data = asRecord(props.loaderData);
  const posts = asRecordList(data?.posts);
  const categories = asRecordList(data?.categories);
  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm font-semibold uppercase text-primary">CMS Demo</p>
        <h1 className="mt-2 text-3xl font-semibold text-foreground">Published content</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Published posts, categories, and SEO metadata are served by the cms-demo module.
        </p>
      </header>
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="rounded-md border border-border bg-card p-4">
          <h2 className="text-base font-semibold text-foreground">Published posts</h2>
          {posts.length > 0 ? (
            <ul className="mt-3 divide-y divide-border text-sm">
              {posts.map((post, index) => (
                <li key={String(post.id ?? post.slug ?? index)} className="py-3">
                  <p className="font-medium text-foreground">
                    {String(post.title ?? post.slug ?? 'Untitled')}
                  </p>
                  {post.excerpt ? (
                    <p className="mt-1 text-muted-foreground">{String(post.excerpt)}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              {String(data?.emptyState ?? 'No published posts yet.')}
            </p>
          )}
        </div>
        <div className="rounded-md border border-border bg-card p-4">
          <h2 className="text-base font-semibold text-foreground">Categories</h2>
          <p className="mt-2 text-2xl font-semibold text-foreground">{categories.length}</p>
          {data?.dataState ? (
            <p className="mt-2 text-sm text-destructive">{String(data.dataState)}</p>
          ) : null}
        </div>
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
