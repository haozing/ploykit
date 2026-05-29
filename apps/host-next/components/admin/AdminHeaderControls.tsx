'use client';

import { useRouter } from 'next/navigation';
import { useParams } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { isSupportedLanguage } from '@host/lib/i18n';

export function AdminRefreshButton() {
  const router = useRouter();
  const params = useParams<{ lang?: string }>();
  const lang = params.lang && isSupportedLanguage(params.lang) ? params.lang : 'zh';

  return (
    <button
      type="button"
      className="inline-flex min-h-8 items-center justify-center gap-2 rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-admin-surface-muted"
      onClick={() => router.refresh()}
    >
      <RefreshCw className="h-3.5 w-3.5" aria-hidden />
      {adminInlineText(lang, 'Refresh')}
    </button>
  );
}
