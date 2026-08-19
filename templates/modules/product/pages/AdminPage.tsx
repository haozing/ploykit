export default function AdminPage(props?: { data?: { noteCount?: number; checks?: string[] } }) {
  return (
    <main>
      <h1>__MODULE_NAME__ admin</h1>
      <p>Notes: {props?.data?.noteCount ?? 0}</p>
      <ul>{(props?.data?.checks ?? []).map((check) => <li key={check}>{check}</li>)}</ul>
    </main>
  );
}
