const statCards = ['Users', 'Modules', 'Runs'];
const rows = ['Account review', 'Module catalog', 'Service health', 'Recent activity'];

function Block({ className }: { className: string }) {
  return <span className={`block animate-pulse rounded-admin-md bg-admin-surface-muted ${className}`} aria-hidden />;
}

export default function AdminLoading() {
  return (
    <main className="min-h-screen bg-admin-bg text-admin-text">
      <div className="flex min-h-screen">
        <aside className="hidden h-screen w-[248px] shrink-0 border-r border-admin-border bg-admin-surface px-3 py-4 lg:sticky lg:top-0 lg:block" aria-hidden="true">
          <div className="mb-5 flex items-center gap-3 px-3">
            <span className="grid h-9 w-9 place-items-center rounded-admin-md bg-admin-text text-xs font-bold text-admin-surface">P</span>
            <span className="min-w-0">
              <Block className="h-4 w-20" />
              <Block className="mt-2 h-3 w-14" />
            </span>
          </div>
          <nav className="space-y-6">
            {Array.from({ length: 7 }, (_, index) => (
              <div key={index} className="space-y-2">
                <Block className="h-3 w-20" />
                <Block className="h-9 w-full" />
                <Block className="h-9 w-10/12" />
              </div>
            ))}
          </nav>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex min-h-16 items-center gap-2 border-b border-admin-border bg-admin-surface/95 px-4 backdrop-blur sm:gap-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-2 lg:hidden">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-admin-md bg-admin-text text-xs font-bold text-admin-surface">P</span>
              <Block className="h-4 w-14" />
            </div>
            <div className="hidden min-w-0 flex-1 items-center gap-2 xl:flex">
              <Block className="h-8 w-40" />
            </div>
            <div className="hidden w-full max-w-sm lg:flex xl:max-w-md 2xl:max-w-lg">
              <Block className="h-10 w-full" />
            </div>
            <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1 sm:gap-2">
              <Block className="h-9 w-9" />
              <Block className="h-9 w-9" />
              <Block className="hidden h-9 w-36 sm:block" />
            </div>
          </header>

          <section className="mx-auto grid w-full max-w-[1480px] gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
            <div className="mb-1 space-y-2">
              <Block className="h-8 w-64 max-w-full" />
              <Block className="h-4 w-full max-w-3xl" />
            </div>

            <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3" aria-hidden="true">
              {statCards.map((item) => (
                <article key={item} className="min-h-[96px] rounded-admin-md border border-admin-border bg-admin-surface p-3 shadow-admin-card sm:min-h-[120px] sm:p-5">
                  <div className="flex items-center gap-2">
                    <Block className="h-8 w-8" />
                    <Block className="h-4 w-20" />
                  </div>
                  <Block className="mt-4 h-8 w-16" />
                  <Block className="mt-3 h-3 w-28" />
                </article>
              ))}
            </section>

            <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.45fr)]">
              <article className="rounded-admin-md border border-admin-border bg-admin-surface shadow-admin-card">
                <header className="border-b border-admin-border px-4 py-4 sm:px-5">
                  <Block className="h-5 w-32" />
                  <Block className="mt-2 h-4 w-full max-w-md" />
                </header>
                <div className="grid gap-3 p-4 sm:p-5">
                  {rows.slice(0, 2).map((row) => (
                    <div key={row} className="rounded-admin-md border border-admin-border bg-admin-bg/45 p-4">
                      <Block className="h-3 w-24" />
                      <Block className="mt-3 h-5 w-44" />
                      <Block className="mt-2 h-4 w-full max-w-lg" />
                    </div>
                  ))}
                </div>
              </article>
              <article className="rounded-admin-md border border-admin-border bg-admin-surface shadow-admin-card">
                <header className="border-b border-admin-border px-4 py-4 sm:px-5">
                  <Block className="h-5 w-20" />
                  <Block className="mt-2 h-4 w-48" />
                </header>
                <div className="grid gap-2 p-4 sm:p-5">
                  {rows.map((row) => (
                    <div key={row} className="flex items-center justify-between rounded-admin-md border border-admin-border px-3 py-2">
                      <Block className="h-4 w-32" />
                      <Block className="h-4 w-12" />
                    </div>
                  ))}
                </div>
              </article>
            </section>
          </section>
        </section>
      </div>
    </main>
  );
}
