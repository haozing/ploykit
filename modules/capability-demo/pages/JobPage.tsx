export default function JobPage() {
  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm font-semibold uppercase text-primary">Capability Workflow</p>
        <h1 className="mt-2 text-3xl font-semibold text-foreground">Background workflow</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          This module declares a worker job, an event handler, and an inbound webhook receipt path.
        </p>
      </header>
      <dl className="divide-y divide-border rounded-md border border-border bg-card px-4">
        <div className="grid gap-1 py-3 sm:grid-cols-[140px_1fr]">
          <dt className="text-sm text-muted-foreground">Action</dt>
          <dd className="text-sm font-medium text-foreground">enqueueReport</dd>
        </div>
        <div className="grid gap-1 py-3 sm:grid-cols-[140px_1fr]">
          <dt className="text-sm text-muted-foreground">Webhook</dt>
          <dd className="text-sm font-medium text-foreground">/api/module-webhooks/capability-demo/workflow/webhook</dd>
        </div>
        <div className="grid gap-1 py-3 sm:grid-cols-[140px_1fr]">
          <dt className="text-sm text-muted-foreground">Task center</dt>
          <dd><a className="text-sm font-medium text-primary hover:underline" href="/zh/dashboard/tasks">Open tasks</a></dd>
        </div>
      </dl>
    </main>
  );
}
