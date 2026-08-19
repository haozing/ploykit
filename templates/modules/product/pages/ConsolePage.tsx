export default function ConsolePage(props?: { data?: { notes?: unknown[] } }) {
  return <main><h1>__MODULE_NAME__ console</h1><p>Notes: {props?.data?.notes?.length ?? 0}</p></main>;
}
