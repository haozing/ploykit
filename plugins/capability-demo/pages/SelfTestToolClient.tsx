'use client';

import { useMemo, useState } from 'react';

type CheckStatus = 'passed' | 'failed' | 'skipped';

interface SelfTestCheck {
  id: string;
  capability: string;
  status: CheckStatus;
  durationMs: number;
  evidence?: Record<string, unknown>;
  reason?: string;
  error?: {
    code?: string;
    message: string;
    statusCode?: number;
  };
}

interface SelfTestResult {
  ok: boolean;
  seed: string;
  generatedAt: string;
  statusCounts: Record<CheckStatus, number>;
  checks: SelfTestCheck[];
}

function statusClass(status: CheckStatus): string {
  if (status === 'passed') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }

  if (status === 'skipped') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }

  return 'border-red-200 bg-red-50 text-red-700';
}

export default function SelfTestToolClient() {
  const [includeAi, setIncludeAi] = useState(true);
  const [includeExternal, setIncludeExternal] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SelfTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedChecks = useMemo(() => {
    return [...(result?.checks ?? [])].sort((left, right) => {
      const weight: Record<CheckStatus, number> = { failed: 0, skipped: 1, passed: 2 };
      return weight[left.status] - weight[right.status] || left.id.localeCompare(right.id);
    });
  }, [result]);

  async function runSelfTest() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/plugins/capability-demo/self-test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ includeAi, includeExternal }),
      });
      const body = (await response.json()) as SelfTestResult | { error?: { message?: string } };

      if (!response.ok) {
        throw new Error(
          'error' in body && body.error?.message
            ? body.error.message
            : `Self-test failed with HTTP ${response.status}`
        );
      }

      setResult(body as SelfTestResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 rounded-md border bg-background p-4">
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeAi}
              onChange={(event) => setIncludeAi(event.target.checked)}
            />
            Include AI
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeExternal}
              onChange={(event) => setIncludeExternal(event.target.checked)}
            />
            Include external HTTP
          </label>
        </div>
        <button
          type="button"
          onClick={runSelfTest}
          disabled={loading}
          className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {loading ? 'Running...' : 'Run Self Test'}
        </button>
      </section>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {result ? (
        <section className="space-y-4">
          <div className="grid gap-3 rounded-md border bg-muted/20 p-4 sm:grid-cols-4">
            <div>
              <div className="text-xs uppercase text-muted-foreground">Status</div>
              <div className="mt-1 text-lg font-semibold">{result.ok ? 'Passed' : 'Failed'}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">Passed</div>
              <div className="mt-1 text-lg font-semibold">{result.statusCounts.passed}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">Skipped</div>
              <div className="mt-1 text-lg font-semibold">{result.statusCounts.skipped}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">Failed</div>
              <div className="mt-1 text-lg font-semibold">{result.statusCounts.failed}</div>
            </div>
          </div>

          <div className="grid gap-3">
            {sortedChecks.map((check) => (
              <article key={check.id} className="rounded-md border bg-background p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold">{check.capability}</h2>
                    <p className="text-xs text-muted-foreground">{check.id}</p>
                  </div>
                  <span className={`rounded border px-2 py-1 text-xs ${statusClass(check.status)}`}>
                    {check.status}
                  </span>
                </div>
                {check.error || check.reason ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {check.error?.message ?? check.reason}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
