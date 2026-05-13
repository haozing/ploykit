import type { PluginRuntimePageProps } from '@ploykit/plugin-sdk';

export default function DevAssetsTool(props: PluginRuntimePageProps) {
  const workerUrl = props.assets['assets/editor.worker.js'];
  const templateUrl = props.assets['assets/template.svg'];

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Plugin Assets Demo</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Declared plugin assets are served through the host asset gateway.
        </p>
      </div>
      <section className="grid gap-4 md:grid-cols-[260px_1fr]">
        <div className="rounded-md border bg-muted/20 p-4">
          {templateUrl ? (
            <object
              data={templateUrl}
              type="image/svg+xml"
              aria-label="Capability demo template asset"
              className="aspect-square w-full rounded bg-background"
            >
              Capability demo template asset
            </object>
          ) : (
            <div className="text-sm text-muted-foreground">Template asset missing</div>
          )}
        </div>
        <div className="rounded-md border p-4">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground">Asset Map</h2>
          <pre className="mt-4 overflow-auto rounded-md bg-muted/40 p-3 text-xs">
            {JSON.stringify({ workerUrl, templateUrl }, null, 2)}
          </pre>
        </div>
      </section>
    </main>
  );
}
