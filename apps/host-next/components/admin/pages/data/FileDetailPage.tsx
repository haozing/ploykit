import Link from 'next/link';
import { adminNav, EmptyState, StatCard, WorkspaceShell } from '@host/components/ProductShell';
import { DataTable, DetailDrawer } from '@host/components/ui';
import { CopyButton } from '@host/components/ui/CopyButton';
import {
  ActionPanel,
  AdminPanel,
  CodeBlockPanel,
  FactList,
  StatGrid,
  TimelineList,
} from '@host/components/admin/shared/AdminPrimitives';
import { type SupportedLanguage } from '@host/lib/i18n';
import { formatBytes } from '@host/lib/i18n-format';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminFileDetailCopy } from '@host/lib/admin-copy';
import { redactSensitive } from '@/lib/module-runtime/observability/redaction';
import type { AdminFileDetailView } from '@host/lib/admin-files';

function compactJson(value: unknown, maxLength = Number.POSITIVE_INFINITY): string {
  if (value === undefined) {
    return '';
  }
  const text = JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

export function AdminFileDetailOperationsPage({
  lang,
  detail,
}: {
  lang: SupportedLanguage;
  detail: AdminFileDetailView;
}) {
  const copy = getAdminFileDetailCopy(lang);
  const file = detail.file;
  const storageObject = detail.storageObject;
  const access = detail.access;
  const cleanup = detail.cleanup;

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      {file ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-5">
            <StatGrid>
              <StatCard
                label={adminInlineText(lang, 'Status')}
                value={file.status}
                tone={file.status === 'ready' ? 'blue' : 'amber'}
              />
              <StatCard label={adminInlineText(lang, 'Storage')} value={detail.storage.mode} />
              <StatCard
                label={adminInlineText(lang, 'Size')}
                value={formatBytes(file.sizeBytes, lang)}
              />
              <StatCard label={adminInlineText(lang, 'Visibility')} value={file.visibility} />
            </StatGrid>

            <ActionPanel
              title={file.name}
              description={`${file.moduleId} / ${file.purpose} / ${file.ownerId ?? 'system'}`}
              tone={
                storageObject?.status === 'missing'
                  ? 'warning'
                  : file.status === 'quarantined'
                    ? 'danger'
                    : 'neutral'
              }
              actions={
                <>
                  <Link
                    href={`/api/media/${file.id}`}
                    className="inline-flex min-h-9 items-center justify-center rounded-admin-md bg-admin-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-admin-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                  >
                    {adminInlineText(lang, 'Open')}
                  </Link>
                  <Link
                    href={`/api/media/${file.id}?download=1`}
                    className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-4 py-2 text-sm font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                  >
                    {adminInlineText(lang, 'Download')}
                  </Link>
                </>
              }
            />

            <AdminPanel
              title={adminInlineText(lang, 'Storage object')}
              description={adminInlineText(
                lang,
                'Physical object evidence stays separate from file metadata.'
              )}
              contentClassName="p-0"
            >
              <DataTable
                className="rounded-none border-x-0 shadow-none"
                columns={adminInlineColumns(lang, ['Storage Object', 'Value'])}
                rows={[
                  ['State', storageObject?.status ?? 'unknown'],
                  [
                    'Physical object present',
                    cleanup?.physicalObjectPresent === null
                      ? 'unknown'
                      : String(Boolean(cleanup?.physicalObjectPresent)),
                  ],
                  ['Object Key', storageObject?.key ?? file.storageKey],
                  [
                    'Object Size',
                    storageObject?.sizeBytes === null || storageObject?.sizeBytes === undefined
                      ? 'missing'
                      : formatBytes(storageObject.sizeBytes, lang),
                  ],
                  ['Object Checksum', storageObject?.checksum ?? 'missing'],
                  ['Object Content-Type', storageObject?.contentType ?? 'unknown'],
                  ['Checked At', storageObject?.checkedAt ?? 'not checked'],
                  ['Storage Error', storageObject?.error ?? 'none'],
                ]}
                minWidthClass="min-w-[760px]"
              />
            </AdminPanel>

            <AdminPanel
              title={adminInlineText(lang, 'Access and cleanup')}
              description={adminInlineText(
                lang,
                'Download access and cleanup eligibility are explicit operational facts.'
              )}
              contentClassName="p-0"
            >
              <DataTable
                className="rounded-none border-x-0 shadow-none"
                columns={adminInlineColumns(lang, ['Access / Cleanup', 'Value'])}
                rows={[
                  ['Media Gateway', access?.mediaGateway ?? 'blocked'],
                  ['Open URL', access?.openUrl ?? 'blocked'],
                  ['Download URL', access?.downloadUrl ?? 'blocked'],
                  ['Access Reason', access?.reason ?? 'file is missing'],
                  ['Cleanup Eligible', cleanup ? String(cleanup.eligible) : 'false'],
                  ['Latest Cleanup Audit', cleanup?.latestCleanupAt ?? 'none'],
                  ['Cleanup Command', cleanup?.command ?? 'npm run host:files-cleanup-smoke'],
                  ['Cleanup Reason', cleanup?.reason ?? 'file is missing'],
                ]}
                minWidthClass="min-w-[760px]"
              />
            </AdminPanel>

            <div className="grid gap-5 lg:grid-cols-2">
              <CodeBlockPanel
                lang={lang}
                title={adminInlineText(lang, 'File metadata')}
                description={adminInlineText(lang, 'Redacted file metadata.')}
                value={JSON.stringify(redactSensitive(file.metadata), null, 2)}
              />
              <CodeBlockPanel
                lang={lang}
                title={adminInlineText(lang, 'Object metadata')}
                description={adminInlineText(lang, 'Redacted storage metadata.')}
                value={JSON.stringify(redactSensitive(storageObject?.metadata ?? {}), null, 2)}
              />
            </div>

            <AdminPanel
              title={adminInlineText(lang, 'Audit timeline')}
              description={adminInlineText(
                lang,
                'File lifecycle, access, cleanup and governance events.'
              )}
            >
              <TimelineList
                lang={lang}
                items={detail.audit.map((record) => ({
                  key: record.id,
                  title: record.type,
                  description: compactJson(record.metadata, 180),
                  meta: `${record.actorId ?? 'system'} · ${record.createdAt}`,
                  tone:
                    record.type.includes('delete') || record.type.includes('cleanup')
                      ? 'warning'
                      : 'primary',
                }))}
                empty={adminInlineText(lang, 'No file audit yet.')}
              />
            </AdminPanel>
          </div>

          <DetailDrawer
            open
            title={adminInlineText(lang, 'File snapshot')}
            description={file.name}
            actions={
              <CopyButton
                value={file.id}
                label={adminInlineText(lang, 'Copy ID')}
                copiedLabel={adminInlineText(lang, 'Copied ID')}
              />
            }
            className="xl:sticky xl:top-24 xl:self-start"
          >
            <FactList
              lang={lang}
              items={[
                { label: 'File ID', value: file.id, copyValue: file.id, mono: true },
                { label: 'Product', value: file.productId, mono: true },
                { label: 'Workspace', value: file.workspaceId ?? 'product', mono: true },
                { label: 'Run', value: file.runId ?? 'none', mono: true },
                { label: 'Content-Type', value: file.contentType ?? 'unknown' },
                { label: 'Checksum', value: file.checksum ?? 'missing', mono: true },
                {
                  label: 'Storage Key',
                  value: file.storageKey,
                  copyValue: file.storageKey,
                  mono: true,
                },
                {
                  label: 'Object',
                  value: storageObject?.status ?? 'unknown',
                  tone: storageObject?.status === 'missing' ? 'warning' : 'neutral',
                },
                { label: 'Created', value: file.createdAt },
                { label: 'Updated', value: file.updatedAt },
              ]}
            />
          </DetailDrawer>
        </div>
      ) : (
        <EmptyState title={copy.missingTitle}>{copy.missingBody}</EmptyState>
      )}
    </WorkspaceShell>
  );
}
