export default function ConsolePage(props?: { data?: { notes?: unknown[] } }) {
  return {
    view: '__MODULE_ID__.console',
    notes: props?.data?.notes ?? [],
  };
}
