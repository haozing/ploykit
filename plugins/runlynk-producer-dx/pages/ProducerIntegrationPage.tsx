'use client';

import type { PluginRuntimePageProps } from '@ploykit/plugin-sdk';
import { useCallback, useEffect, useState } from 'react';
import {
  copyText,
  downloadTextFile,
  pluginPagePath,
  requestJson,
  statusTone,
  type ProducerKeySummary,
} from '../lib/ui-client';

type Language = 'typescript' | 'python' | 'curl';
type IntegrationPayload = {
  contract: { task_key: string };
  snippet: string;
  prompt: string;
};

export default function ProducerIntegrationPage(props: PluginRuntimePageProps) {
  const { projectId, taskTypeId } = props.params;
  const [language, setLanguage] = useState<Language>('typescript');
  const [producerKeys, setProducerKeys] = useState<ProducerKeySummary[]>([]);
  const [newKey, setNewKey] = useState<ProducerKeySummary | null>(null);
  const [snippet, setSnippet] = useState('');
  const [prompt, setPrompt] = useState('');
  const [taskKey, setTaskKey] = useState(taskTypeId);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    const payload = await requestJson<{ producer_keys: ProducerKeySummary[] }>(
      props.pluginId,
      `/projects/${projectId}/producer-keys`
    );
    return payload.producer_keys ?? [];
  }, [props.pluginId, projectId]);

  const fetchIntegration = useCallback(
    async (nextLanguage: Language, key?: ProducerKeySummary | null) =>
      requestJson<IntegrationPayload>(
        props.pluginId,
        `/projects/${projectId}/task-types/${taskTypeId}/integration`,
        {
          method: 'POST',
          body: JSON.stringify({
            language: nextLanguage,
            producer_key: key ?? undefined,
          }),
        }
      ),
    [props.pluginId, projectId, taskTypeId]
  );

  const loadKeys = useCallback(async () => {
    setProducerKeys(await fetchKeys());
  }, [fetchKeys]);

  const generate = useCallback(
    async (nextLanguage: Language, key?: ProducerKeySummary | null) => {
      try {
        const payload = await fetchIntegration(nextLanguage, key);
        setError(null);
        setTaskKey(payload.contract.task_key);
        setSnippet(payload.snippet);
        setPrompt(payload.prompt);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [fetchIntegration]
  );

  const createKey = useCallback(async () => {
    setError(null);
    try {
      const payload = await requestJson<{ producer_key: ProducerKeySummary }>(
        props.pluginId,
        `/projects/${projectId}/producer-keys`,
        {
          method: 'POST',
          body: JSON.stringify({ name: `Producer DX ${new Date().toISOString()}` }),
        }
      );
      setNewKey(payload.producer_key);
      await loadKeys();
      await generate(language, payload.producer_key);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [generate, language, loadKeys, projectId, props.pluginId]);

  async function copy(label: string, value: string) {
    await copyText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1600);
  }

  useEffect(() => {
    async function loadInitial() {
      try {
        const [keys, integration] = await Promise.all([
          fetchKeys(),
          fetchIntegration(language, null),
        ]);
        setError(null);
        setProducerKeys(keys);
        setTaskKey(integration.contract.task_key);
        setSnippet(integration.snippet);
        setPrompt(integration.prompt);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    }

    void loadInitial();
  }, [fetchIntegration, fetchKeys, language]);

  const filename =
    language === 'typescript'
      ? 'runlynk-producer.ts'
      : language === 'python'
        ? 'runlynk-producer.py'
        : 'runlynk-producer.curl.txt';

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <a href={pluginPagePath(props, '/')} className="text-sm text-muted-foreground">
            Producer DX
          </a>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Producer Integration</h1>
          <p className="mt-2 font-mono text-xs text-muted-foreground">{taskKey}</p>
        </div>
        <button
          type="button"
          onClick={() => void createKey()}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
        >
          Create Producer Key
        </button>
      </header>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {newKey?.key ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-amber-900">Producer API Key</h2>
            <button
              type="button"
              onClick={() => void copy('producerKey', newKey.key ?? '')}
              className="rounded-md border border-amber-300 bg-background px-3 py-1.5 text-xs font-medium"
            >
              {copied === 'producerKey' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="mt-3 overflow-auto rounded-md bg-background p-3 text-xs">
            {newKey.key}
          </pre>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-4 rounded-md border bg-background p-4">
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Language</span>
            <select
              value={language}
              onChange={(event) => {
                const next = event.target.value as Language;
                setLanguage(next);
              }}
              className="rounded-md border bg-background px-3 py-2"
            >
              <option value="typescript">TypeScript</option>
              <option value="python">Python</option>
              <option value="curl">curl</option>
            </select>
          </label>

          <div>
            <h2 className="text-sm font-semibold">Producer Keys</h2>
            <div className="mt-3 space-y-2">
              {producerKeys.map((key) => (
                <div key={key.id} className="rounded-md border p-2 text-xs">
                  <div className="font-medium">{key.name}</div>
                  <span
                    className={`mt-2 inline-flex rounded border px-2 py-1 ${statusTone(key.status)}`}
                  >
                    {key.status}
                  </span>
                </div>
              ))}
              {!producerKeys.length ? (
                <p className="text-xs text-muted-foreground">No producer keys yet.</p>
              ) : null}
            </div>
          </div>
        </aside>

        <div className="grid gap-4">
          <section className="rounded-md border bg-background p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase text-muted-foreground">Snippet</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void copy('snippet', snippet)}
                  className="rounded-md border px-3 py-1.5 text-xs font-medium"
                >
                  {copied === 'snippet' ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={() => downloadTextFile(filename, snippet)}
                  className="rounded-md border px-3 py-1.5 text-xs font-medium"
                >
                  Download
                </button>
              </div>
            </div>
            <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap text-xs">{snippet}</pre>
          </section>

          <section className="rounded-md border bg-background p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase text-muted-foreground">
                Integration Prompt
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
