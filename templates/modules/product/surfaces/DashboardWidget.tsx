export default function DashboardWidget() {
  return (
    <div>
      <strong>__MODULE_NAME__</strong>
      <span className="ml-2 text-sm text-muted-foreground">Ready</span>
      <a className="ml-3 text-sm text-primary hover:underline" href="/dashboard/__MODULE_ID__">Open</a>
    </div>
  );
}
