'use client';

import type { PluginRuntimePageProps } from '@ploykit/plugin-sdk';
import { useCallback, useEffect, useState } from 'react';
import {
  formatJSON,
  pluginPagePath,
  requestJson,
  type WorkerContractSummary,
} from '../lib/ui-client';

export default function WorkerContractPage(props: PluginRuntimePageProps) {
  const { projectId, taskTypeId } = props.params;
  const [contract, setContract] = useState<WorkerContractSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchContract = useCallback(
    async () =>
      requestJson<WorkerContractSummary>(
        props.pluginId,
        `/projects/${projectId}/task-types/${taskTypeId}/contract`
      ),
    [projectId, props.pluginId, taskTypeId]
  );

  useEffect(() => {
    async function loadInitial() {
      try {
        const payload = await fetchContract();
        setError(null);
        setContract(payload);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    }

    void loadInitial();
  }, [fetchContract]);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <a href={pluginPagePath(props, '/')} className="text-sm text-muted-foreground">
            Worker DX
          </a>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Worker Contract</h1>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {contract?.task_key ?? taskTypeId}
          </p>
        </div>
        <div className="flex gap-2">
          <a
            className="rounded-md border px-3 py-2 text-sm font-medium"
            href={pluginPagePath(props, `/projects/${projectId}/task-types/${taskTypeId}/starter`)}
          >
            Starter
          </a>
          <a
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            href={pluginPagePath(
              props,
              `/projects/${projectId}/task-types/${taskTypeId}/validator`
            )}
          >
            Validator
          </a>
        </div>
      </header>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="rounded-md border bg-background p-4">
        <pre className="overflow-auto text-xs">{formatJSON(contract)}</pre>
      </section>
    </main>
  );
}
