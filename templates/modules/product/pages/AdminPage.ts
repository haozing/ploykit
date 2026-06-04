export default function AdminPage(props?: { data?: { noteCount?: number; checks?: string[] } }) {
  return {
    view: '__MODULE_ID__.admin',
    noteCount: props?.data?.noteCount ?? 0,
    checks: props?.data?.checks ?? [],
  };
}
