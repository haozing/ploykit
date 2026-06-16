import Link from 'next/link';
import { Input, Select } from '@host/components/ui';
import { AdvancedFilterPanel } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminTableQuery } from '@host/lib/table-query';
import { fileStatusOptions } from './FileDirectoryPageModel';

export function FileDirectoryFilters({
  lang,
  tableQuery,
}: {
  lang: SupportedLanguage;
  tableQuery: Required<AdminTableQuery>;
}) {
  return (
    <form method="get" className="grid gap-3 border-b border-admin-border bg-admin-bg/35 px-4 py-3">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px_auto] md:items-end">
        <label className="grid gap-2 text-sm font-medium text-admin-text">
          <span>{adminInlineText(lang, 'Search')}</span>
          <Input
            type="search"
            name="q"
            defaultValue={tableQuery.q}
            placeholder={adminInlineText(lang, '文件名、ID、模块、owner 或路径')}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-admin-text">
          <span>{adminInlineText(lang, 'Status')}</span>
          <Select
            name="status"
            defaultValue={tableQuery.status}
            aria-label={adminInlineText(lang, 'Status')}
          >
            <option value="">{adminInlineText(lang, 'All')}</option>
            {fileStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {adminInlineText(lang, option.label)}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-2 text-sm font-medium text-admin-text">
          <span>{adminInlineText(lang, 'Module')}</span>
          <Input
            name="moduleId"
            defaultValue={tableQuery.moduleId}
            placeholder={adminInlineText(lang, 'moduleId')}
          />
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <button
            type="submit"
            className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 py-1.5 text-xs font-semibold text-admin-primary transition hover:bg-admin-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
          >
            {adminInlineText(lang, 'Filter')}
          </button>
          <Link
            href={localizedPath(lang, '/admin/files')}
            className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
          >
            {adminInlineText(lang, 'Clear')}
          </Link>
        </div>
      </div>
      <AdvancedFilterPanel
        lang={lang}
        defaultOpen={Boolean(
          tableQuery.owner ||
            tableQuery.mime ||
            tableQuery.provider ||
            tableQuery.path ||
            tableQuery.from ||
            tableQuery.to ||
            tableQuery.minSize ||
            tableQuery.maxSize
        )}
        description={adminInlineText(
          lang,
          '所有者、MIME、供应商、路径、日期和大小是排障筛选，默认折叠以保护目录页的扫描速度。'
        )}
      >
        <label className="grid gap-2 text-sm font-medium text-admin-text">
          <span>{adminInlineText(lang, 'Owner')}</span>
          <Input
            name="owner"
            defaultValue={tableQuery.owner}
            placeholder={adminInlineText(lang, 'owner id/email')}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-admin-text">
          <span>{adminInlineText(lang, 'MIME')}</span>
          <Input
            name="mime"
            defaultValue={tableQuery.mime}
            placeholder={adminInlineText(lang, 'image/json/text')}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-admin-text">
          <span>{adminInlineText(lang, 'Provider')}</span>
          <Select
            name="provider"
            defaultValue={tableQuery.provider}
            aria-label={adminInlineText(lang, 'Provider')}
          >
            <option value="">{adminInlineText(lang, 'All')}</option>
            <option value="local">{adminInlineText(lang, 'Local')}</option>
            <option value="s3">S3</option>
            <option value="memory">{adminInlineText(lang, 'Memory')}</option>
          </Select>
        </label>
        <label className="grid gap-2 text-sm font-medium text-admin-text">
          <span>{adminInlineText(lang, 'Path')}</span>
          <Input
            name="path"
            defaultValue={tableQuery.path}
            placeholder={adminInlineText(lang, 'folder/path')}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-admin-text">
          <span>{adminInlineText(lang, 'From')}</span>
          <Input type="date" name="from" defaultValue={tableQuery.from.slice(0, 10)} />
        </label>
        <label className="grid gap-2 text-sm font-medium text-admin-text">
          <span>{adminInlineText(lang, 'To')}</span>
          <Input type="date" name="to" defaultValue={tableQuery.to.slice(0, 10)} />
        </label>
        <label className="grid gap-2 text-sm font-medium text-admin-text">
          <span>{adminInlineText(lang, 'Min')}</span>
          <Input
            name="minSize"
            defaultValue={tableQuery.minSize ? String(tableQuery.minSize) : ''}
            placeholder={adminInlineText(lang, 'bytes')}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-admin-text">
          <span>{adminInlineText(lang, 'Max')}</span>
          <Input
            name="maxSize"
            defaultValue={tableQuery.maxSize ? String(tableQuery.maxSize) : ''}
            placeholder={adminInlineText(lang, 'bytes')}
          />
        </label>
      </AdvancedFilterPanel>
    </form>
  );
}
