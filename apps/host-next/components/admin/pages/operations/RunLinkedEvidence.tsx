import { DataTable } from '@host/components/ui';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import { AdminPanel } from '@host/components/admin/shared/AdminPrimitives';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import { type SupportedLanguage } from '@host/lib/i18n';
import type { AdminRunDetailView } from '@host/lib/admin-runs';
import { compactJson } from './OperationsPageUtils';

export function RunLinkedEvidence({
  lang,
  detail,
}: {
  lang: SupportedLanguage;
  detail: AdminRunDetailView;
}) {
  return (
    <AdminPanel
      title={adminInlineText(lang, 'Linked evidence')}
      description={adminInlineText(
        lang,
        'Outbox, delivery ledger, files, usage and audit records are grouped below the timeline.'
      )}
      contentClassName="grid gap-4"
    >
      <DataTable
        className="shadow-none"
        columns={adminInlineColumns(lang, ['Event / Outbox', 'Status', 'Attempts / Error'])}
        rows={
          detail.outbox.length > 0
            ? detail.outbox.map((record) => [
                record.name,
                <StatusBadge key={record.id} lang={lang} value={record.status} />,
                `${record.attempts} · ${record.error?.message ?? 'ok'}`,
              ])
            : [['-', '-', '0']]
        }
        minWidthClass="min-w-[760px]"
        density="compact"
      />
      <DataTable
        className="shadow-none"
        columns={adminInlineColumns(lang, [
          'Delivery',
          'Status',
          'Worker / Attempts',
          'Error / Retry',
        ])}
        rows={
          detail.deliveries.length > 0
            ? detail.deliveries.map((record) => [
                `${record.kind} · ${record.source}`,
                <StatusBadge key={record.id} lang={lang} value={record.status} />,
                `${record.workerId ?? 'no worker'} · ${record.attempts}`,
                record.error?.message ?? record.nextRetryAt ?? 'ok',
              ])
            : [['-', '-', 'no worker', 'No run-linked delivery ledger records']]
        }
        minWidthClass="min-w-[820px]"
        density="compact"
      />
      <DataTable
        className="shadow-none"
        columns={adminInlineColumns(lang, ['File / Artifact', 'Status', 'Purpose / Size', 'Storage'])}
        rows={
          detail.files.length + detail.artifacts.length > 0
            ? [
                ...detail.files.map((file) => [
                  file.name,
                  <StatusBadge key={file.id} lang={lang} value={file.status} />,
                  `${file.purpose} · ${file.sizeBytes} bytes`,
                  file.storageKey,
                ]),
                ...detail.artifacts.map((artifact) => [
                  artifact.name,
                  <StatusBadge key={artifact.id} lang={lang} value="artifact" />,
                  `${artifact.kind} · in-memory artifact`,
                  artifact.path,
                ]),
              ]
            : [['-', '-', 'No run-linked files or artifacts', '-']]
        }
        minWidthClass="min-w-[820px]"
        density="compact"
      />
      <DataTable
        className="shadow-none"
        columns={adminInlineColumns(lang, ['Usage Meter', 'Quantity', 'Source'])}
        rows={
          detail.usage.length > 0
            ? detail.usage.map((record) => [
                record.meter,
                `${record.quantity} ${record.unit ?? 'count'}`,
                compactJson(record.metadata, 160),
              ])
            : [['-', '0', 'No run-linked usage records']]
        }
        minWidthClass="min-w-[740px]"
        density="compact"
      />
      <DataTable
        className="shadow-none"
        columns={adminInlineColumns(lang, ['Audit', 'Actor', 'Metadata'])}
        rows={
          detail.audit.length > 0
            ? detail.audit.map((record) => [
                record.type,
                record.actorId ?? 'system',
                compactJson(record.metadata, 160),
              ])
            : [['-', 'system', 'No run-linked audit records']]
        }
        minWidthClass="min-w-[740px]"
        density="compact"
      />
    </AdminPanel>
  );
}
