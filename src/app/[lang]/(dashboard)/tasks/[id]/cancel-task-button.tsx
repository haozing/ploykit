'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/shared/auth-client';

export function CancelTaskButton({ taskId, disabled }: { taskId: string; disabled: boolean }) {
  const router = useRouter();
  const t = useTranslations('dashboard.taskDetail.actions');
  const [pending, setPending] = React.useState(false);

  async function cancelTask() {
    const reason = window.prompt(t('cancelReasonPrompt'));
    if (reason === null) return;

    setPending(true);
    try {
      const response = await apiFetch(`/api/plugin-runs/${taskId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      if (!response.ok) {
        throw new Error(t('cancelFailed'));
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" disabled={disabled || pending} onClick={cancelTask}>
      <XCircle className="h-4 w-4" />
      {t('cancel')}
    </Button>
  );
}
