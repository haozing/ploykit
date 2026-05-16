'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePluginApi, usePluginTranslations } from '@ploykit/plugin-sdk/react';
import type { PluginTranslate } from '@ploykit/plugin-sdk';

interface ProbeSummary {
  insertedId: string;
  updatedStatus: string;
  readBackOk: boolean;
  transactionId: string;
  deletedGone: boolean;
  statusFilterCount: number;
  nullFilterCount: number;
  inFilterCount: number;
  startsWithCount: number;
  containsCount: number;
  queryMode: string;
}

interface ProbeRecord extends Record<string, unknown> {
  id: string;
  title: string;
  status: string;
  sequence: number;
  active: boolean;
  tags: string[];
  optional_note: string | null;
}

interface ProbeResponse {
  ok: boolean;
  seed: string;
  userId: string | null;
  summary: ProbeSummary;
  records: ProbeRecord[];
}

function StatusPill({ ok, children }: { ok: boolean; children: string }) {
  return (
    <span
      className={
        ok
          ? 'rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700'
          : 'rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700'
      }
    >
      {children}
    </span>
  );
}

function formatProbeRecordTitle(title: string, t: PluginTranslate): string {
  const seed = title.match(/\d+$/)?.[0];
  if (!seed) {
    return title;
  }

  if (title.startsWith('Browser probe')) {
    return `${t('storage.recordTitles.browser')} ${seed}`;
  }
  if (title.startsWith('Transaction probe')) {
    return `${t('storage.recordTitles.transaction')} ${seed}`;
  }
  if (title.startsWith('Delete probe')) {
    return `${t('storage.recordTitles.delete')} ${seed}`;
  }

  return title;
}

export default function StorageProbeClient() {
  const api = usePluginApi();
  const t = usePluginTranslations();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProbeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runProbe = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const body = await api.json<ProbeResponse>('/storage-probe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'browser-real-test' }),
      });
      setResult(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void runProbe();
  }, [runProbe]);

  return (
    <section
      data-testid="host-lab-storage-probe"
      className="mt-8 rounded-md border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{t('storage.title')}</h2>
          <p className="mt-1 text-sm text-slate-600">{t('storage.body')}</p>
        </div>
        <button
          type="button"
          onClick={runProbe}
          disabled={loading}
          className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {loading ? t('storage.running') : t('storage.runAgain')}
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <StatusPill ok={result.ok}>{t('storage.apiOk')}</StatusPill>
            <StatusPill ok={result.summary.readBackOk}>{t('storage.readByIdOk')}</StatusPill>
            <StatusPill ok={result.summary.deletedGone}>{t('storage.deleteOk')}</StatusPill>
            <StatusPill ok={Boolean(result.summary.transactionId)}>
              {t('storage.transactionOk')}
            </StatusPill>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-md bg-slate-50 p-3">
              <div className="text-xs uppercase text-slate-500">{t('storage.statusFilter')}</div>
              <div className="mt-1 text-xl font-semibold text-slate-950">
                {result.summary.statusFilterCount}
              </div>
            </div>
            <div className="rounded-md bg-slate-50 p-3">
              <div className="text-xs uppercase text-slate-500">{t('storage.nullFilter')}</div>
              <div className="mt-1 text-xl font-semibold text-slate-950">
                {result.summary.nullFilterCount}
              </div>
            </div>
            <div className="rounded-md bg-slate-50 p-3">
              <div className="text-xs uppercase text-slate-500">{t('storage.inFilter')}</div>
              <div className="mt-1 text-xl font-semibold text-slate-950">
                {result.summary.inFilterCount}
              </div>
            </div>
            <div className="rounded-md bg-slate-50 p-3">
              <div className="text-xs uppercase text-slate-500">{t('storage.jsonContains')}</div>
              <div className="mt-1 text-xl font-semibold text-slate-950">
                {result.summary.containsCount}
              </div>
            </div>
          </div>

          <div className="rounded-md border border-slate-200">
            <div className="border-b border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
              {t('storage.latestRecords')}
            </div>
            <div className="divide-y divide-slate-200">
              {result.records.map((record) => (
                <div
                  key={record.id}
                  className="grid gap-2 px-3 py-3 text-sm md:grid-cols-[1fr_120px_100px]"
                >
                  <div>
                    <div className="font-medium text-slate-950">
                      {formatProbeRecordTitle(record.title, t)}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{record.id}</div>
                  </div>
                  <div className="text-slate-700">
                    {t(`storage.statusLabels.${record.status}`, { fallback: record.status })}
                  </div>
                  <div className="text-slate-700">{record.sequence}</div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-slate-500">
            {t('storage.queryMode')}: {result.summary.queryMode}; {t('storage.seed')}: {result.seed}
            ; {t('storage.user')}: {result.userId}
          </p>
        </div>
      ) : null}
    </section>
  );
}
