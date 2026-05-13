import type { PluginRuntimePageProps } from '@ploykit/plugin-sdk';

export default function JsonFormatTool(_props: PluginRuntimePageProps) {
  return (
    <main className="mx-auto grid max-w-6xl gap-6 p-6 lg:grid-cols-[1fr_320px]">
      <section className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">JSON Formatter</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Paste JSON, format it, and validate the public tool route with SEO metadata.
          </p>
        </div>
        <div className="grid gap-3 rounded-md border bg-background p-4">
          <textarea
            aria-label="JSON input"
            className="min-h-[360px] rounded-md border bg-muted/30 p-3 font-mono text-sm"
            defaultValue={'{"plugin":"capability-demo","status":"ready","items":[1,2,3]}'}
          />
          <div className="flex flex-wrap gap-2">
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Format
            </button>
            <button className="rounded-md border px-4 py-2 text-sm font-medium">Minify</button>
            <button className="rounded-md border px-4 py-2 text-sm font-medium">Copy</button>
          </div>
        </div>
      </section>
      <aside className="space-y-3 rounded-md border bg-muted/20 p-4">
        <h2 className="text-sm font-semibold uppercase text-muted-foreground">Route Contract</h2>
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Canonical</dt>
            <dd className="font-mono">/tools/json-format</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Anonymous Policy</dt>
            <dd>Rate limited, no high-cost actions</dd>
          </div>
        </dl>
      </aside>
    </main>
  );
}
