import { AdminPanel, HealthRowList } from '@host/components/admin/shared/AdminPrimitives';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';

export function RunQueueLanes({
  lang,
  running,
  queued,
  failed,
  waitingExternal,
}: {
  lang: SupportedLanguage;
  running: number;
  queued: number;
  failed: number;
  waitingExternal: number;
}) {
  return (
    <AdminPanel
      title={adminInlineText(lang, 'Queue lanes')}
      description={adminInlineText(
        lang,
        'A run queue should read like an operations tool: which lane is blocked, why, and what happens next.'
      )}
    >
      <HealthRowList
        lang={lang}
        items={[
          {
            key: 'running',
            title: 'Running',
            detail: 'Worker is currently executing these runs.',
            meta: `${running} active`,
            status: running > 0 ? 'active' : 'clear',
            statusTone: running > 0 ? 'info' : 'success',
            tone: running > 0 ? 'info' : 'success',
          },
          {
            key: 'queued',
            title: 'Queued',
            detail: 'Waiting for worker capacity or dependency slots.',
            meta: `${queued} waiting`,
            status: queued > 0 ? 'waiting' : 'clear',
            statusTone: queued > 0 ? 'warning' : 'success',
            tone: queued > 0 ? 'warning' : 'success',
          },
          {
            key: 'failed',
            title: 'Failed',
            detail: 'Inspect logs and requeue only after the error reason is understood.',
            meta: `${failed} failed`,
            status: failed > 0 ? 'review' : 'clear',
            statusTone: failed > 0 ? 'danger' : 'success',
            tone: failed > 0 ? 'danger' : 'success',
            href: failed > 0 ? localizedPath(lang, '/admin/runs?status=failed') : undefined,
          },
          {
            key: 'external',
            title: 'Waiting external',
            detail:
              'Provider, secret, quota, or rate limit evidence should be fixed outside the run itself.',
            meta: `${waitingExternal} blocked`,
            status: waitingExternal > 0 ? 'blocked' : 'clear',
            statusTone: waitingExternal > 0 ? 'warning' : 'success',
            tone: waitingExternal > 0 ? 'warning' : 'success',
          },
        ]}
      />
    </AdminPanel>
  );
}
