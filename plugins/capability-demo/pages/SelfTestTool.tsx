import type { PluginRuntimePageProps } from '@ploykit/plugin-sdk';
import SelfTestToolClient from './SelfTestToolClient';

export default function SelfTestTool(_props: PluginRuntimePageProps) {
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Capability Self Test</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Run the demo plugin against the host capability runtime and inspect the JSON result.
        </p>
      </div>

      <SelfTestToolClient />

      <section className="rounded-md border bg-muted/20 p-4">
        <h2 className="text-sm font-semibold uppercase text-muted-foreground">API Endpoint</h2>
        <pre className="mt-3 overflow-auto rounded-md bg-muted/40 p-3 text-xs">
          POST /api/plugins/capability-demo/self-test
        </pre>
      </section>
    </main>
  );
}
