'use client';

import type { PluginRuntimePageProps } from '@ploykit/plugin-sdk';
import { useCallback, useEffect, useState } from 'react';
import {
  copyText,
  downloadTextFile,
  pluginPagePath,
  requestJson,
  type WorkerContractSummary,
} from '../lib/ui-client';

type WorkerStarterLanguage = 'python' | 'typescript' | 'http';

export default function WorkerStarterPage(props: PluginRuntimePageProps) {
  const { projectId, taskTypeId } = props.params;
  const [contract, setContract] = useState<WorkerContractSummary | null>(null);
  const [language, setLanguage] = useState<WorkerStarterLanguage>('python');
  const [starter, setStarter] = useState('');
  const [prompt, setPrompt] = useState('');
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

  const fetchGeneratedContent = useCallback(
    async (nextLanguage: WorkerStarterLanguage) =>
      Promise.all([
        requestJson<{ starter: string }>(
          props.pluginId,
          `/projects/${projectId}/task-types/${taskTypeId}/starter`,
          {
            method: 'POST',
            body: JSON.stringify({ language: nextLanguage }),
          }
        ),
        requestJson<{ prompt: string }>(
          props.pluginId,
          `/projects/${projectId}/task-types/${taskTypeId}/prompt`,
          {
            method: 'POST',
            body: JSON.stringify({}),
          }
        ),
      ]),
    [projectId, props.pluginId, taskTypeId]
  );

  useEffect(() => {
    async function loadInitial() {
      try {
        const [contractPayload, [starterPayload, promptPayload]] = await Promise.all([
          fetchContract(),
          fetchGeneratedContent(language),
        ]);
        setError(null);
        setContract(contractPayload);
        setStarter(starterPayload.starter);
        setPrompt(promptPayload.prompt);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    }

    void loadInitial();
  }, [fetchContract, fetchGeneratedContent, language]);

  const starterFilename =
    language === 'python'
      ? 'runlynk-worker.py'
      : language === 'typescript'
        ? 'runlynk-worker.ts'
        : 'runlynk-worker.http.txt';

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
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Starter & Prompt</h1>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {contract?.task_key ?? taskTypeId}
          </p>
        </div>
        <a
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          href={pluginPagePath(props, `/projects/${projectId}/task-types/${taskTypeId}/validator`)}
        >
          Validator
        </a>
      </header>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <aside className="rounded-md border bg-background p-4">
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Language</span>
            <select
              value={language}
              onChange={(event) => {
                const next = event.target.value as typeof language;
                setLanguage(next);
              }}
              className="rounded-md border bg-background px-3 py-2"
            >
              <option value="python">Python</option>
              <option value="typescript">TypeScript</option>
              <option value="http">Raw HTTP</option>
            </select>
          </label>
        </aside>
        <div className="grid gap-4">
          <section className="rounded-md border bg-background p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase text-muted-foreground">Starter</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void copy('starter', starter)}
                  className="rounded-md border px-3 py-1.5 text-xs font-medium"
                >
                  {copied === 'starter' ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={() => downloadTextFile(starterFilename, starter)}
                  className="rounded-md border px-3 py-1.5 text-xs font-medium"
                >
                  Download
                </button>
              </div>
            </div>
            <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap text-xs">{starter}</pre>
          </section>
          <section className="rounded-md border bg-background p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase text-muted-foreground">
                Worker Prompt
              </h2>
              <button
                type="button"
                onClick={() => void copy('prompt', prompt)}
                className="rounded-md border px-3 py-1.5 text-xs font-medium"
              >
                {copied === 'prompt' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap text-xs">{prompt}</pre>
          </section>
        </div>
      </section>
    </main>
  );
}
