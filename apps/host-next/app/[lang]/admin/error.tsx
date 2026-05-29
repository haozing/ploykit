'use client';

import { useParams } from 'next/navigation';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@host/components/ui';
import { readHostMessageValue } from '@host/lib/host-i18n';
import { isSupportedLanguage } from '@host/lib/i18n';

interface AdminErrorCopy {
  eyebrow: string;
  title: string;
  description: string;
  message: string;
  digest: string;
  unknown: string;
  retry: string;
}

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams<{ lang?: string }>();
  const lang = params.lang && isSupportedLanguage(params.lang) ? params.lang : 'zh';
  const copy = readHostMessageValue<AdminErrorCopy>(lang, 'admin.error');
  return (
    <main className="min-h-screen bg-admin-bg px-4 py-8 text-admin-text sm:px-6 lg:px-8">
      <section className="mx-auto flex min-h-[520px] w-full max-w-4xl items-center justify-center">
        <div className="w-full rounded-admin-md border border-admin-danger/20 bg-admin-surface p-6 shadow-admin-card sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-admin-md border border-admin-danger/20 bg-admin-danger/10 text-admin-danger">
              <AlertTriangle className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase text-admin-danger">{copy.eyebrow}</p>
              <h1 className="mt-2 text-[28px] font-bold leading-9 text-admin-text">{copy.title}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-admin-text-muted">
                {copy.description}
              </p>
              <div className="mt-5 grid gap-2 rounded-admin-md border border-admin-border bg-admin-bg/55 p-4 text-xs text-admin-text-muted">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-semibold text-admin-text-subtle">{copy.message}</span>
                  <span className="min-w-0 max-w-xl truncate text-right text-admin-text">{error.message || copy.unknown}</span>
                </div>
                {error.digest ? (
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-semibold text-admin-text-subtle">{copy.digest}</span>
                    <span className="font-mono text-admin-text">{error.digest}</span>
                  </div>
                ) : null}
              </div>
              <div className="mt-6">
                <Button type="button" onClick={reset} className="min-w-28">
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  {copy.retry}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
