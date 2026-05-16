'use client';

import type { PluginRuntimePageProps } from '@ploykit/plugin-sdk';
import { useCallback, useEffect, useState } from 'react';
import {
  copyText,
  formatJSON,
  pluginPagePath,
  requestJson,
  statusTone,
  type ValidatorSummary,
  type WorkerContractSummary,
} from '../lib/ui-client';

const TERMINAL_STATES = new Set(['passed', 'failed', 'cancelled']);

export default function WorkerValidatorPage(props: PluginRuntimePageProps) {
  const { projectId, taskTypeId } = props.params;
  const [contract, setContract] = useState<WorkerContractSummary | null>(null);
  const [workerToken, setWorkerToken] = useState('');
  const [jobId, setJobId] = useState('');
  const [status, setStatus] = useState<ValidatorSummary | null>(null);
  const [fixPrompt, setFixPrompt] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchContract = useCallback(
    async () =>
      requestJson<WorkerContractSummary>(
        props.pluginId,
        `/projects/${projectId}/task-types/${taskTypeId}/contract`
      ),
    [projectId, props.pluginId, taskTypeId]
  );

  const refresh = useCallback(
    async (nextJobId = jobId) => {
      if (!nextJobId) {
        return;
      }
      try {
        const payload = await requestJson<ValidatorSummary>(
          props.pluginId,
          `/projects/${projectId}/jobs/${nextJobId}/validator`
        );
        setError(null);
        setStatus(payload);
        if (TERMINAL_STATES.has(payload.state)) {
          setAutoRefresh(false);
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [jobId, projectId, props.pluginId]
  );

  const createMockJob = useCallback(async () => {
    try {
      const payload = await requestJson<{
        job: { id: string };
        worker_token?: string;
        contract: WorkerContractSummary;
      }>(props.pluginId, `/projects/${projectId}/task-types/${taskTypeId}/mock-job`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setError(null);
      setFixPrompt('');
      setContract(payload.contract);
      setJobId(payload.job.id);
      setWorkerToken(payload.worker_token ?? '');
      setAutoRefresh(true);
      await refresh(payload.job.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [projectId, props.pluginId, refresh, taskTypeId]);

  const generateFixPrompt = useCallback(async () => {
    if (!jobId) {
      return;
    }
    const payload = await requestJson<{ prompt: string }>(
      props.pluginId,
      `/projects/${projectId}/jobs/${jobId}/fix-prompt`,
      {
        method: 'POST',
        body: JSON.stringify({ task_type_id: taskTypeId }),
      }
    );
    setFixPrompt(payload.prompt);
  }, [jobId, projectId, props.pluginId, taskTypeId]);

  useEffect(() => {
    async function loadInitial() {
      try {
        setContract(await fetchContract());
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    }

    void loadInitial();
  }, [fetchContract]);

  useEffect(() => {
    if (!autoRefresh || !jobId) {
      return;
    }
    if (status && TERMINAL_STATES.has(status.state)) {
      return;
    }
    const timer = window.setInterval(() => {
      void refresh(jobId);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [autoRefresh, jobId, refresh, status]);

  async function copy(label: string, value: string) {
    await copyText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1600);
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <a href={pluginPagePath(props, '/')} className="text-sm text-muted-foreground">
            Worker DX
          </a>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Validator</h1>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {contract?.task_key ?? taskTypeId}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={createMockJob}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Create Mock Job
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={!jobId}
            className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setAutoRefresh((value) => !value)}
            disabled={!jobId}
            className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60"
          >
            {autoRefresh ? 'Stop Polling' : 'Auto Poll'}
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {workerToken ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-amber-900">Worker Token</h2>
            <button
              type="button"
              onClick={() => void copy('token', workerToken)}
              className="rounded-md border border-amber-300 bg-background px-3 py-1.5 text-xs font-medium"
            >
              {copied === 'token' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="mt-3 overflow-auto rounded-md bg-background p-3 text-xs">
            {workerToken}
          </pre>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <article className="rounded-md border bg-background p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">Status</h2>
          {status ? (
            <div className="space-y-3">
              <span
                className={`inline-flex rounded border px-2 py-1 text-xs ${statusTone(status.state)}`}
              >
                {status.state}
              </span>
              <p className="font-mono text-xs text-muted-foreground">{status.job.id}</p>
              <div className="space-y-2">
                {status.checks.map((check) => (
                  <div
                    key={check.key}
                    className="flex items-center justify-between rounded-md border p-2 text-sm"
                  >
                    <span>{check.label}</span>
                    <span className={check.passed ? 'text-emerald-600' : 'text-muted-foreground'}>
                      {check.passed ? 'passed' : 'pending'}
                    </span>
                  </div>
                ))}
              </div>
              {status.state === 'failed' || status.state === 'cancelled' ? (
                <button
                  type="button"
                  onClick={() => void generateFixPrompt()}
                  className="rounded-md border px-3 py-2 text-sm font-medium"
                >
                  Generate Fix Prompt
                </button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Create a mock job to start validation.</p>
          )}
        </article>

        <article className="rounded-md border bg-background p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase text-muted-foreground">Run Locally</h2>
            <button
              type="button"
              onClick={() =>
                void copy(
                  'command',
                  `$env:RUNLYNK_CORE_URL="http://localhost:8080"
$env:RUNLYNK_WORKER_TOKEN="${workerToken || '<create mock job first>'}"
python worker.py`
                )
              }
              className="rounded-md border px-3 py-1.5 text-xs font-medium"
            >
              {copied === 'command' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="whitespace-pre-wrap text-xs">{`$env:RUNLYNK_CORE_URL="http://localhost:8080"
$env:RUNLYNK_WORKER_TOKEN="${workerToken || '<create mock job first>'}"
python worker.py`}</pre>
        </article>
      </section>

      {status ? (
        <section className="rounded-md border bg-background p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
            Events & Logs
          </h2>
          <pre className="max-h-[360px] overflow-auto text-xs">
            {formatJSON({ events: status.events, logs: status.logs })}
          </pre>
        </section>
      ) : null}

      {fixPrompt ? (
        <section className="rounded-md border bg-background p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase text-muted-foreground">Fix Prompt</h2>
            <button
              type="button"
              onClick={() => void copy('fixPrompt', fixPrompt)}
              className="rounded-md border px-3 py-1.5 text-xs font-medium"
            >
              {copied === 'fixPrompt' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap text-xs">{fixPrompt}</pre>
        </section>
      ) : null}
    </main>
  );
}
