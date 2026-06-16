import Link from 'next/link';
import { DetailDrawer } from '@host/components/ui';
import { FactList } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { RuntimeStoreAuditRecord } from '@/lib/module-runtime';
import { redactSensitive } from '@/lib/module-runtime/observability/redaction';

export function AuditDetailDrawer({
  lang,
  focusAudit,
}: {
  lang: SupportedLanguage;
  focusAudit: RuntimeStoreAuditRecord;
}) {
  return (
    <DetailDrawer
      open
      title={adminInlineText(lang, 'Audit detail')}
      description={`${focusAudit.type} · ${focusAudit.id}`}
      className="mb-5"
      actions={[
        <Link
          key="search"
          href={localizedPath(lang, `/admin/search?q=${encodeURIComponent(focusAudit.id)}`)}
          className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
        >
          {adminInlineText(lang, 'Search')}
        </Link>,
        <Link
          key="module"
          href={localizedPath(
            lang,
            `/admin/modules?q=${encodeURIComponent(focusAudit.moduleId ?? '')}`
          )}
          className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
        >
          {adminInlineText(lang, 'Module')}
        </Link>,
        <Link
          key="user"
          href={localizedPath(
            lang,
            `/admin/users?q=${encodeURIComponent(focusAudit.actorId ?? '')}`
          )}
          className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
        >
          {adminInlineText(lang, 'Actor')}
        </Link>,
      ]}
    >
      <FactList
        lang={lang}
        density="compact"
        items={[
          { label: 'Audit ID', value: focusAudit.id, copyValue: focusAudit.id, mono: true },
          { label: 'Type', value: focusAudit.type },
          { label: 'Actor', value: focusAudit.actorId ?? 'system' },
          { label: 'Module', value: focusAudit.moduleId ?? 'host' },
          { label: 'Product', value: focusAudit.productId },
          { label: 'Workspace', value: focusAudit.workspaceId ?? 'global' },
          { label: 'Risk', value: focusAudit.integrity?.risk ?? 'unknown' },
          { label: 'Category', value: focusAudit.integrity?.category ?? 'none' },
          { label: 'Resource', value: focusAudit.integrity?.resourceType ?? 'none' },
          {
            label: 'Resource ID',
            value: focusAudit.integrity?.resourceId ?? 'none',
            mono: true,
          },
          {
            label: 'Correlation',
            value: focusAudit.integrity?.correlationId ?? 'none',
            mono: true,
          },
          {
            label: 'Record hash',
            value: focusAudit.integrity?.recordHash ?? 'none',
            mono: true,
          },
          { label: 'Created', value: focusAudit.createdAt },
        ]}
      />
      <div className="mt-4 rounded-admin-md border border-admin-border bg-admin-bg/45">
        <div className="border-b border-admin-border px-3 py-2 text-xs font-semibold uppercase text-admin-text-subtle">
          {adminInlineText(lang, 'Metadata')}
        </div>
        <pre className="max-h-56 overflow-auto break-all p-3 text-xs leading-5 text-admin-text-muted">
          {JSON.stringify(redactSensitive(focusAudit.metadata), null, 2)}
        </pre>
      </div>
    </DetailDrawer>
  );
}
