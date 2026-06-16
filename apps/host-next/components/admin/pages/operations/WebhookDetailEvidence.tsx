import {
  AdminPanel,
  CodeBlockPanel,
  HealthRowList,
} from '@host/components/admin/shared/AdminPrimitives';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { SupportedLanguage } from '@host/lib/i18n';
import type { AdminOutboxDetailView } from '@host/lib/admin-delivery';
import { redactSensitive } from '@/lib/module-runtime/observability/redaction';
import { adminRelatedHref, outboxKind } from './OperationsPageUtils';

export function AdminWebhookDetailEvidence({
  lang,
  outbox,
}: {
  lang: SupportedLanguage;
  outbox: NonNullable<AdminOutboxDetailView['outbox']>;
}) {
  const kind = outboxKind(outbox);

  return (
    <>
      <AdminPanel
        title={adminInlineText(lang, 'Related operations')}
        description={adminInlineText(
          lang,
          'outbox_detail_keeps_runs_jobs_events_service_and_aud_9d9d5900'
        )}
      >
        <HealthRowList
          lang={lang}
          items={[
            {
              key: 'outbox-related-runs',
              title: 'Runs',
              detail: 'Run records linked by outbox id, run id, module id, or correlation metadata.',
              meta: outbox.id,
              status: 'linked',
              statusTone: 'info',
              tone: 'info',
              href: adminRelatedHref(lang, '/admin/runs', { q: outbox.id }),
            },
            {
              key: 'outbox-related-jobs',
              title: 'Jobs',
              detail: 'Job execution is currently represented by run kind and job:* outbox records.',
              meta: outbox.moduleId ?? 'host',
              status: kind === 'job' ? 'current' : 'run-kind',
              statusTone: 'info',
              tone: 'primary',
              href: adminRelatedHref(lang, '/admin/runs', {
                q: outbox.moduleId ?? outbox.name,
                type: 'job',
              }),
            },
            {
              key: 'outbox-related-events',
              title: 'Events',
              detail: 'Event delivery uses event:* outbox records and subscriber delivery ledger.',
              meta: kind === 'event' ? outbox.name : 'event:*',
              status: kind === 'event' ? 'current' : 'outbox-kind',
              statusTone: 'info',
              tone: kind === 'event' ? 'warning' : 'neutral',
              href: adminRelatedHref(lang, '/admin/webhooks', { q: 'event:' }),
            },
            {
              key: 'outbox-related-service',
              title: 'Service',
              detail: 'Provider and secret readiness for the module or host service.',
              meta: outbox.moduleId ?? 'host',
              status: 'linked',
              statusTone: 'info',
              tone: 'neutral',
              href: adminRelatedHref(lang, '/admin/service-connections', {
                q: outbox.moduleId ?? outbox.name,
              }),
            },
            {
              key: 'outbox-related-audit',
              title: 'Audit',
              detail: 'Replay, discard, archive, receipt retry, and worker drain audit records.',
              meta: outbox.id,
              status: 'linked',
              statusTone: 'info',
              tone: 'neutral',
              href: adminRelatedHref(lang, '/admin/audit', { q: outbox.id }),
            },
          ]}
        />
      </AdminPanel>

      <div className="grid gap-5 lg:grid-cols-3">
        <CodeBlockPanel
          lang={lang}
          title={adminInlineText(lang, 'Payload')}
          description={adminInlineText(lang, 'Redacted delivery payload.')}
          value={JSON.stringify(redactSensitive(outbox.payload), null, 2)}
        />
        <CodeBlockPanel
          lang={lang}
          title={adminInlineText(lang, 'Metadata')}
          description={adminInlineText(lang, 'Redacted delivery metadata.')}
          value={JSON.stringify(redactSensitive(outbox.metadata), null, 2)}
        />
        <CodeBlockPanel
          lang={lang}
          title={adminInlineText(lang, 'Error')}
          description={adminInlineText(lang, 'Delivery failure evidence.')}
          value={JSON.stringify(redactSensitive(outbox.error ?? {}), null, 2)}
        />
      </div>
    </>
  );
}
