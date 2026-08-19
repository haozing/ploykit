export default function AiRagPage() {
  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm font-semibold uppercase text-primary">AI RAG Demo</p>
        <h1 className="mt-2 text-3xl font-semibold text-foreground">AI RAG workspace</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Index a source file, build a RAG context pack, and call the host AI provider.
        </p>
      </header>
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-card p-4">
          <h2 className="font-semibold text-foreground">Ask</h2>
          <p className="mt-2 text-sm text-muted-foreground">POST /api/modules/ai-rag-demo/ask</p>
        </div>
        <div className="rounded-md border border-border bg-card p-4">
          <h2 className="font-semibold text-foreground">Usage guard</h2>
          <p className="mt-2 text-sm text-muted-foreground">Dashboard, API, and action use one credit guard.</p>
        </div>
      </section>
    </main>
  );
}
