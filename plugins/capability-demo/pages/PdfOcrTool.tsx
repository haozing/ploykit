import type { PluginRuntimePageProps } from '@ploykit/plugin-sdk';

export default function PdfOcrTool(_props: PluginRuntimePageProps) {
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">PDF OCR Demo</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A host-flow preview for upload quotas, task center visibility, file handoff, and page
          metering.
        </p>
      </div>
      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="rounded-md border border-dashed bg-muted/20 p-8 text-center">
          <div className="text-lg font-semibold">Drop PDF</div>
          <p className="mt-2 text-sm text-muted-foreground">
            Public route allows 5 MB before auth.
          </p>
          <button className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Select File
          </button>
        </div>
        <div className="rounded-md border p-4">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground">Expected Run</h2>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <span>Visibility</span>
              <span className="font-mono">user-visible</span>
            </div>
            <div className="flex justify-between">
              <span>Meter</span>
              <span className="font-mono">capability-demo.ocr.page</span>
            </div>
            <div className="flex justify-between">
              <span>File purpose</span>
              <span className="font-mono">source/result</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
