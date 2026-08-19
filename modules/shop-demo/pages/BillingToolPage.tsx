export default function BillingToolPage() {
  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm font-semibold uppercase text-primary">Shop Billing Guard</p>
        <h1 className="mt-2 text-3xl font-semibold text-foreground">Paid shop tool</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          This tool is protected by entitlement and credit requirements.
        </p>
      </header>
      <dl className="divide-y divide-border rounded-md border border-border bg-card px-4">
        <div className="grid gap-1 py-3 sm:grid-cols-[140px_1fr]"><dt className="text-sm text-muted-foreground">Entitlement</dt><dd className="text-sm font-medium text-foreground">demo.entitlement</dd></div>
        <div className="grid gap-1 py-3 sm:grid-cols-[140px_1fr]"><dt className="text-sm text-muted-foreground">Action</dt><dd className="text-sm font-medium text-foreground">runPaidTool</dd></div>
      </dl>
      <a className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground" href="/zh/dashboard/billing">Upgrade in billing</a>
    </main>
  );
}
