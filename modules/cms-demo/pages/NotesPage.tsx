export default function NotesPage(props: { loaderData?: unknown }) {
  const data = asRecord(props.loaderData);
  const notes = asRecordList(data?.notes);
  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm font-semibold uppercase text-primary">CMS Notes</p>
        <h1 className="mt-2 text-3xl font-semibold text-foreground">Workspace notes</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Workspace notes use CMS Data v2 tables and optional file attachments.
        </p>
      </header>
      <section className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
        <p>Notes API: /api/modules/cms-demo/notes</p>
        <p className="mt-2">Create action: createNote</p>
        <p className="mt-2">Data state: {String(data?.dataState ?? 'ready')}</p>
        <p className="mt-2">Total notes: {String(data?.total ?? notes.length)}</p>
        <p className="mt-2">File attachments: {data?.canAttachFiles ? 'enabled' : 'disabled'}</p>
        {data?.message ? <p className="mt-2 text-destructive">Data is currently unavailable.</p> : null}
      </section>
      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="text-base font-semibold text-foreground">Recent notes</h2>
        {notes.length > 0 ? (
          <ul className="mt-3 divide-y divide-border text-sm">
            {notes.map((note, index) => (
              <li key={String(note.id ?? index)} className="py-3">
                <p className="font-medium text-foreground">{String(note.title ?? 'Untitled')}</p>
                <p className="mt-1 text-muted-foreground">{String(note.status ?? 'unknown')}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No notes yet.</p>
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
