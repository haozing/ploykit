import type { PluginRuntimePageProps } from '@ploykit/plugin-sdk';

export default function ImageCutoutTool(_props: PluginRuntimePageProps) {
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Image Cutout Demo</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A public tool route for validating anonymous upload policy and item-based metering.
        </p>
      </div>
      <section className="grid gap-4 md:grid-cols-2">
        <div className="aspect-[4/3] rounded-md border bg-[linear-gradient(45deg,#f4f4f5_25%,transparent_25%),linear-gradient(-45deg,#f4f4f5_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f4f4f5_75%),linear-gradient(-45deg,transparent_75%,#f4f4f5_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0] p-4">
          <div className="flex h-full items-center justify-center rounded-md border bg-background/80">
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Upload Image
            </button>
          </div>
        </div>
        <div className="rounded-md border p-4">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground">Metering</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Meter</dt>
              <dd className="font-mono">capability-demo.image.item</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Default Cost</dt>
              <dd>2 credits per item</dd>
            </div>
          </dl>
        </div>
      </section>
    </main>
  );
}
