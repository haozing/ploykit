import Link from 'next/link';
import { Database } from 'lucide-react';
import { DataTable } from '@host/components/ui';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import {
  AdminPanel,
  EntityListItem,
  FilterBar,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminTableQuery } from '@host/lib/table-query';
import type {
  RuntimeStoreMeteringLedgerEntry,
  RuntimeStoreUsageRecord,
} from '@/lib/module-runtime';
import {
  compactJson,
  meteringStatusOptions,
  type AdminPagedResult,
} from './UsagePageModel';

export function UsageRecordsSection({
  lang,
  tableQuery,
  usage,
  metering,
}: {
  lang: SupportedLanguage;
  tableQuery: Required<AdminTableQuery>;
  usage: AdminPagedResult<RuntimeStoreUsageRecord>;
  metering: AdminPagedResult<RuntimeStoreMeteringLedgerEntry>;
}) {
  return (
    <AdminPanel
      title={adminInlineText(lang, 'Usage records')}
      description={adminInlineText(
        lang,
        'Filter usage and metering by meter, module, state, product scope, or metadata.'
      )}
      contentClassName="p-0"
    >
      <FilterBar
        lang={lang}
        embedded
        searchValue={tableQuery.q}
        searchPlaceholder="搜索 meter、模块、状态或用量"
        filterValue={tableQuery.status}
        filterOptions={meteringStatusOptions}
        resetHref={localizedPath(lang, '/admin/usage')}
      />
      <DataTable
        className="hidden rounded-none border-x-0 shadow-none xl:block"
        columns={adminInlineColumns(lang, [
          'Meter',
          'Module',
          'Workspace',
          'Quantity',
          'Unit',
          'Status',
          'Source',
          'Action',
        ])}
        rows={metering.items.map((record) => [
          record.meter,
          <Link
            key={`${record.id}:module`}
            href={localizedPath(lang, `/admin/modules/${record.moduleId}`)}
            className="font-semibold text-admin-primary hover:underline"
          >
            {record.moduleId}
          </Link>,
          record.workspaceId ?? 'global',
          String(record.quantity),
          record.unit ?? 'count',
          <StatusBadge key={record.id} lang={lang} value={record.status} />,
          compactJson(record.metadata, 140),
          <div key={`${record.id}:action`} className="flex flex-wrap gap-2">
            <Link
              href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(record.id)}`)}
              className="text-xs font-semibold text-admin-primary hover:underline"
            >
              {adminInlineText(lang, 'audit_de9bcda7')}
            </Link>
            <Link
              href={localizedPath(lang, `/admin/modules/${record.moduleId}`)}
              className="text-xs font-semibold text-admin-primary hover:underline"
            >
              {adminInlineText(lang, 'module_46c34f61')}
            </Link>
          </div>,
        ])}
      />
      <DataTable
        className="hidden rounded-none border-x-0 border-b-0 shadow-none xl:block"
        columns={adminInlineColumns(lang, [
          'Usage',
          'Module',
          'Quantity',
          'Unit',
          'Source',
          'Created',
          'Action',
        ])}
        rows={usage.items.map((record) => [
          record.meter,
          <Link
            key={`${record.id}:module`}
            href={localizedPath(lang, `/admin/modules/${record.moduleId}`)}
            className="font-semibold text-admin-primary hover:underline"
          >
            {record.moduleId}
          </Link>,
          String(record.quantity),
          record.unit ?? 'count',
          compactJson(record.metadata, 140),
          record.createdAt,
          <div key={`${record.id}:action`} className="flex flex-wrap gap-2">
            <Link
              href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(record.id)}`)}
              className="text-xs font-semibold text-admin-primary hover:underline"
            >
              {adminInlineText(lang, 'audit_de9bcda7')}
            </Link>
            <Link
              href={localizedPath(lang, `/admin/modules/${record.moduleId}`)}
              className="text-xs font-semibold text-admin-primary hover:underline"
            >
              {adminInlineText(lang, 'module_46c34f61')}
            </Link>
          </div>,
        ])}
      />
      <div className="grid gap-2 px-2 py-2 xl:hidden">
        {[
          ...metering.items.map((record) => ({
            key: `meter:${record.id}`,
            href: localizedPath(lang, `/admin/audit?q=${encodeURIComponent(record.id)}`),
            title: record.meter,
            subtitle: `${record.moduleId} · ${record.workspaceId ?? 'global'}`,
            status: record.status,
            detail: `${record.quantity} ${record.unit ?? 'count'} · ${compactJson(record.metadata, 80)}`,
            meta: record.updatedAt,
          })),
          ...usage.items.map((record) => ({
            key: `usage:${record.id}`,
            href: localizedPath(lang, `/admin/audit?q=${encodeURIComponent(record.id)}`),
            title: record.meter,
            subtitle: `${record.moduleId} · ${record.workspaceId ?? 'global'}`,
            status: 'usage',
            detail: `${record.quantity} ${record.unit ?? 'count'} · ${compactJson(record.metadata, 80)}`,
            meta: record.createdAt,
          })),
        ].map((item) => (
          <EntityListItem
            lang={lang}
            key={item.key}
            href={item.href}
            title={item.title}
            subtitle={item.subtitle}
            status={item.status}
            detail={item.detail}
            meta={item.meta}
            icon={Database}
            tone={item.status === 'committed' || item.status === 'usage' ? 'primary' : 'warning'}
          />
        ))}
      </div>
    </AdminPanel>
  );
}
