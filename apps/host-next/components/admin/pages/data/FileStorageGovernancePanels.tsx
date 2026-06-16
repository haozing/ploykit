import Link from 'next/link';
import { Archive, Database, FileWarning, FolderOpen } from 'lucide-react';
import { StatCard } from '@host/components/ProductShell';
import { ConfirmSubmitButton, DataTable } from '@host/components/ui';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import {
  ActionQueue,
  AdminPanel,
  FactList,
  StatGrid,
} from '@host/components/admin/shared/AdminPrimitives';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import { formatBytes } from '@host/lib/i18n-format';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import type { RuntimeStoreFileRecord } from '@/lib/module-runtime';
import type { HostFileQuotaStatus, HostFileStorageStatus } from '@host/lib/files';
import type { AdminFileStorageReconcileReport } from '@host/lib/admin-files';
import type { AdminFormAction } from './FileDirectoryPageModel';

export function FileStorageGovernancePanels({
  lang,
  quota,
  files,
  filteredFiles,
  storage,
  reconcile,
  cleanupDeletedFilesAction,
}: {
  lang: SupportedLanguage;
  quota?: HostFileQuotaStatus;
  files: readonly RuntimeStoreFileRecord[];
  filteredFiles: readonly RuntimeStoreFileRecord[];
  storage: HostFileStorageStatus;
  reconcile: AdminFileStorageReconcileReport;
  cleanupDeletedFilesAction: AdminFormAction;
}) {
  const archivedFiles = files.filter((file) => file.status === 'archived').length;
  const quarantinedFiles = files.filter((file) => file.status === 'quarantined').length;
  const quotaPressure = quota
    ? Math.max(
        quota.perUserBytes > 0 ? quota.userBytes / quota.perUserBytes : 0,
        quota.perWorkspaceBytes > 0 ? quota.workspaceBytes / quota.perWorkspaceBytes : 0,
        quota.perModuleBytes > 0 ? quota.moduleBytes / quota.perModuleBytes : 0
      )
    : 0;
  const storageReviewItems = [
    !storage.durable
      ? {
          key: 'storage-durability',
          title: 'Storage is not durable',
          description: `The current file provider is ${storage.mode}. Move file objects to durable storage before production traffic.`,
          actionLabel: 'Review settings',
          href: localizedPath(lang, '/admin/settings'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
    !storage.s3Configured
      ? {
          key: 's3-config',
          title: 'S3 is not configured',
          description:
            'Object storage configuration is missing. Local or memory storage is acceptable for development only.',
          actionLabel: 'Configure storage',
          href: localizedPath(lang, '/admin/settings'),
          status: 'missing',
          tone: 'warning' as const,
        }
      : null,
    reconcile.issues > 0
      ? {
          key: 'reconcile-issues',
          title: 'Storage reconcile issues',
          description: `${reconcile.issues} metadata/object consistency issues were found during the latest scan.`,
          actionLabel: 'Review reconcile',
          href: localizedPath(lang, '/admin/files'),
          status: 'warning',
          tone: 'danger' as const,
        }
      : null,
    reconcile.orphanObjects > 0
      ? {
          key: 'orphan-objects',
          title: adminInlineText(lang, 'orphan_objects_e83d4bbc'),
          description: adminInlineText(
            lang,
            'value_physical_objects_have_no_runtime_metadata_owne_0f58a0e8',
            { value1: reconcile.orphanObjects }
          ),
          actionLabel: adminInlineText(lang, 'review_orphans_e7b8e2ee'),
          href: localizedPath(lang, '/admin/files'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
    quota && quotaPressure >= 0.8
      ? {
          key: 'quota-pressure',
          title: adminInlineText(lang, 'file_quota_pressure_5b000362'),
          description: adminInlineText(
            lang,
            'highest_quota_pressure_is_about_value_review_user_wo_462fc813',
            { value1: Math.round(quotaPressure * 100) }
          ),
          actionLabel: adminInlineText(lang, 'review_quota_00df702c'),
          href: localizedPath(lang, '/admin/files'),
          status: quotaPressure >= 1 ? 'blocked' : 'warning',
          tone: quotaPressure >= 1 ? ('danger' as const) : ('warning' as const),
        }
      : null,
    quarantinedFiles > 0
      ? {
          key: 'quarantine',
          title: 'Quarantined files',
          description: `${quarantinedFiles} files are quarantined and should be reviewed before restore or deletion.`,
          actionLabel: 'Filter quarantine',
          href: localizedPath(lang, '/admin/files?status=quarantined'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <>
      <StatGrid className="order-1">
        <StatCard
          label={adminInlineText(lang, 'Storage')}
          value={storage.mode}
          helper={
            storage.durable
              ? adminInlineText(lang, 'Durable provider')
              : adminInlineText(lang, 'Development mode')
          }
          tone={storage.durable ? 'green' : 'red'}
          icon={Database}
        />
        <StatCard
          label={adminInlineText(lang, 'Files')}
          value={String(files.length)}
          helper={adminInlineText(lang, 'value_visible_d0396c4d', {
            value1: filteredFiles.length,
          })}
          icon={FolderOpen}
        />
        <StatCard
          label={adminInlineText(lang, 'S3 Config')}
          value={storage.s3Configured ? 'ready' : 'missing'}
          helper={adminInlineText(lang, 'Object storage readiness')}
          tone={storage.s3Configured ? 'green' : 'amber'}
          icon={Archive}
        />
        <StatCard
          label={adminInlineText(lang, 'Storage Issues')}
          value={String(reconcile.issues)}
          helper={adminInlineText(lang, 'value_archived_897b05e4', { value1: archivedFiles })}
          tone={reconcile.issues > 0 ? 'amber' : 'neutral'}
          icon={FileWarning}
        />
      </StatGrid>
      {storageReviewItems.length > 0 ? (
        <ActionQueue
          lang={lang}
          className="order-2"
          title={adminInlineText(lang, 'Storage review')}
          description={adminInlineText(
            lang,
            'Durability, configuration, and reconcile issues are shown before the file directory.'
          )}
          status="warning"
          items={storageReviewItems}
        />
      ) : null}
      <AdminPanel
        className="order-3"
        title={adminInlineText(lang, 'quota_and_business_impact_6445f739')}
        description={adminInlineText(
          lang,
          'file_quota_is_shown_by_user_workspace_and_module_so__cbfc26f6'
        )}
      >
        <FactList
          lang={lang}
          density="compact"
          items={
            quota
              ? [
                  {
                    label: 'Policy source',
                    value: quota.policySource,
                    helper: quota.planId ?? 'global',
                  },
                  {
                    label: 'User quota',
                    value: `${formatBytes(quota.userBytes, lang)} / ${formatBytes(quota.perUserBytes, lang)}`,
                  },
                  {
                    label: 'Workspace quota',
                    value: `${formatBytes(quota.workspaceBytes, lang)} / ${formatBytes(quota.perWorkspaceBytes, lang)}`,
                  },
                  {
                    label: 'Module quota',
                    value: `${formatBytes(quota.moduleBytes, lang)} / ${formatBytes(quota.perModuleBytes, lang)}`,
                  },
                ]
              : [
                  { label: 'Quota', value: adminInlineText(lang, 'not_loaded_75bfeb5e') },
                  { label: 'Business impact', value: adminInlineText(lang, 'unknown_7c2c4389') },
                ]
          }
        />
      </AdminPanel>
      <AdminPanel
        className="order-4"
        title={adminInlineText(lang, 'orphan_object_governance_3a5d296f')}
        description={adminInlineText(
          lang,
          'physical_orphan_objects_should_not_be_inferred_from__0883b4fb'
        )}
      >
        <DataTable
          columns={adminInlineColumns(lang, ['Object', 'Size', 'Checksum', 'Content-Type'])}
          rows={reconcile.orphans
            .slice(0, 12)
            .map((object) => [
              object.key,
              formatBytes(object.sizeBytes, lang),
              object.checksum,
              object.contentType ?? 'unknown',
            ])}
          empty={adminInlineText(lang, 'no_orphan_objects_be30825b')}
        />
      </AdminPanel>
      <AdminPanel
        className="order-5"
        title={adminInlineText(lang, 'Storage reconcile')}
        description={adminInlineText(
          lang,
          'Compare runtime metadata with physical objects and surface drift before cleanup.'
        )}
        action={
          <code className="rounded-admin-md bg-admin-bg px-2 py-1 text-xs text-admin-text-muted">
            {reconcile.command}
          </code>
        }
      >
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p>
              {adminInlineText(
                lang,
                '对 runtime metadata 和物理对象执行一致性扫描，发现 missing object、deleted object present 和 size/checksum 漂移。'
              )}
            </p>
          </div>
        </div>
        <DataTable
          columns={adminInlineColumns(lang, ['Metric', 'Value'])}
          rows={[
            ['Checked Files', `${reconcile.checkedFiles} / ${reconcile.totalFiles}`],
            ['Orphan Scan', reconcile.orphanScanSupported ? 'supported' : 'not supported'],
            ['Present Objects', String(reconcile.presentObjects)],
            ['Missing Objects', String(reconcile.missingObjects)],
            ['Orphan Objects', String(reconcile.orphanObjects)],
            ['Deleted Objects Present', String(reconcile.deletedObjectsPresent)],
            ['Missing Active Objects', String(reconcile.missingActiveObjects)],
            ['Size Mismatches', String(reconcile.sizeMismatches)],
            ['Checksum Mismatches', String(reconcile.checksumMismatches)],
            ['Metadata Bytes', formatBytes(reconcile.metadataBytes, lang)],
            ['Physical Bytes', formatBytes(reconcile.physicalBytes, lang)],
            ['Orphan Bytes', formatBytes(reconcile.orphanBytes, lang)],
            ['Checked At', reconcile.checkedAt],
          ]}
        />
        {reconcile.items.length > 0 ? (
          <DataTable
            columns={adminInlineColumns(lang, [
              'File',
              'Module',
              'Status',
              'Object',
              'Issue',
              'Bytes',
            ])}
            rows={reconcile.items.slice(0, 8).map((item) => [
              <Link key={item.fileId} href={localizedPath(lang, `/admin/files/${item.fileId}`)}>
                {item.name}
              </Link>,
              item.moduleId,
              <StatusBadge key={`${item.fileId}:status`} lang={lang} value={item.status} />,
              item.objectStatus,
              item.issue,
              `${formatBytes(item.metadataSizeBytes, lang)} / ${
                item.objectSizeBytes === null ? 'missing' : formatBytes(item.objectSizeBytes, lang)
              }`,
            ])}
          />
        ) : null}
        {reconcile.orphans.length > 0 ? (
          <DataTable
            columns={adminInlineColumns(lang, [
              'Orphan Object',
              'Size',
              'Checksum',
              'Content-Type',
            ])}
            rows={reconcile.orphans
              .slice(0, 8)
              .map((object) => [
                object.key,
                formatBytes(object.sizeBytes, lang),
                object.checksum,
                object.contentType ?? 'unknown',
              ])}
          />
        ) : null}
      </AdminPanel>
      <form
        action={cleanupDeletedFilesAction}
        className="order-6 rounded-admin-md border border-admin-border bg-admin-surface p-5 shadow-admin-card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <h2>{adminInlineText(lang, 'Cleanup Deleted Objects')}</h2>
          <p>
            {adminInlineText(lang, '清理已经标记 deleted 的对象内容，metadata 会保留用于审计。')}
          </p>
        </div>
        <ConfirmSubmitButton
          type="submit"
          className="inline-flex min-h-10 items-center justify-center rounded-admin-md bg-admin-primary px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
          confirmation={adminInlineText(
            lang,
            '确认清理已删除对象的文件内容？metadata 会继续保留。'
          )}
        >
          {adminInlineText(lang, 'Cleanup')}
        </ConfirmSubmitButton>
      </form>
    </>
  );
}
