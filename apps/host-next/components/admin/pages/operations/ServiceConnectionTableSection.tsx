import Link from 'next/link';
import { Activity } from 'lucide-react';
import { ConfirmSubmitButton, DataTable, Input, Select } from '@host/components/ui';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import { AdvancedFilterPanel, EntityListItem } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { formatBytes } from '@host/lib/i18n-format';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminTableQuery } from '@host/lib/table-query';
import type { AdminServiceConnectionsView } from '@host/lib/admin-service-connections';
import {
  FilterResultHint,
  adminRelatedHref,
  connectionCorrelationKey,
  connectionStatusOptions,
} from './OperationsPageUtils';

type AdminFormAction = (formData: FormData) => void | Promise<void>;
type SelectOption = {
  label: string;
  value: string;
};
type AdminServiceConnectionRow = AdminServiceConnectionsView['connections'][number];

export function AdminServiceConnectionTableSection({
  lang,
  connections,
  tableQuery,
  filteredConnections,
  moduleOptions,
  serviceOptions,
  workspaceOptions,
  environmentOptions,
  testConnectionAction,
  updateConnectionStatusAction,
  rotateConnectionSecretAction,
}: {
  lang: SupportedLanguage;
  connections: AdminServiceConnectionsView;
  tableQuery: AdminTableQuery;
  filteredConnections: readonly AdminServiceConnectionRow[];
  moduleOptions: readonly SelectOption[];
  serviceOptions: readonly SelectOption[];
  workspaceOptions: readonly SelectOption[];
  environmentOptions: readonly SelectOption[];
  testConnectionAction?: AdminFormAction;
  updateConnectionStatusAction?: AdminFormAction;
  rotateConnectionSecretAction?: AdminFormAction;
}) {
  return (
    <>
      <form
        method="get"
        className="grid gap-3 rounded-admin-md border border-admin-border bg-admin-surface p-4 shadow-admin-card"
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end">
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span>{adminInlineText(lang, 'Search')}</span>
            <Input
              type="search"
              name="q"
              defaultValue={tableQuery.q}
              placeholder={adminInlineText(lang, '搜索连接、provider 或缺口说明')}
              aria-label={adminInlineText(lang, '搜索连接、provider 或缺口说明')}
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
              {connectionStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {adminInlineText(lang, option.label)}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <button
              type="submit"
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 py-1.5 text-xs font-semibold text-admin-primary transition hover:bg-admin-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
            >
              {adminInlineText(lang, 'Filter')}
            </button>
            <Link
              href={localizedPath(lang, '/admin/service-connections')}
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
            >
              {adminInlineText(lang, 'Clear')}
            </Link>
          </div>
        </div>
        <AdvancedFilterPanel
          lang={lang}
          defaultOpen={Boolean(
            tableQuery.moduleId ||
            tableQuery.service ||
            tableQuery.workspace ||
            tableQuery.environment
          )}
          description={adminInlineText(
            lang,
            '模块、服务、工作区和环境属于二级筛选，只在排查供应商绑定时展开。'
          )}
        >
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span>{adminInlineText(lang, 'Module')}</span>
            <Select
              name="moduleId"
              defaultValue={tableQuery.moduleId}
              aria-label={adminInlineText(lang, 'Module')}
            >
              <option value="">{adminInlineText(lang, 'All')}</option>
              {moduleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span>{adminInlineText(lang, 'Service')}</span>
            <Select
              name="service"
              defaultValue={tableQuery.service}
              aria-label={adminInlineText(lang, 'Service')}
            >
              <option value="">{adminInlineText(lang, 'All')}</option>
              {serviceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span>{adminInlineText(lang, 'Workspace')}</span>
            <Select
              name="workspace"
              defaultValue={tableQuery.workspace}
              aria-label={adminInlineText(lang, 'Workspace')}
            >
              <option value="">{adminInlineText(lang, 'All')}</option>
              {workspaceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span>{adminInlineText(lang, 'Environment')}</span>
            <Select
              name="environment"
              defaultValue={tableQuery.environment}
              aria-label={adminInlineText(lang, 'Environment')}
            >
              <option value="">{adminInlineText(lang, 'All')}</option>
              {environmentOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
        </AdvancedFilterPanel>
      </form>

      <FilterResultHint
        lang={lang}
        visible={filteredConnections.length}
        total={connections.connections.length}
      />

      <DataTable
        className="hidden xl:block"
        columns={adminInlineColumns(lang, [
          'Connection',
          'Provider',
          'Scope',
          'Status',
          'Policy',
          'Impact',
          'Evidence',
          'Action',
        ])}
        rows={filteredConnections.map((connection) => {
          const evidenceState = connection.lastTestAt
            ? adminInlineText(lang, 'recent')
            : connection.lastError
              ? adminInlineText(lang, 'needs review')
              : adminInlineText(lang, 'stale');
          return [
            <span key={`${connection.id}:connection`}>
              {connection.service}
              <span className="text-sm text-admin-text-muted">
                {connection.moduleId ?? 'host'} · {connection.environment}
              </span>
            </span>,
            <span key={`${connection.id}:provider`}>
              {connection.provider}
              <span className="text-sm text-admin-text-muted">{connection.baseUrl}</span>
            </span>,
            `${connection.ownerType}/${connection.scopeType} · ${connection.workspaceId ?? 'global'}`,
            <span key={`${connection.id}:status`}>
              <StatusBadge lang={lang} value={connection.status} />
              <span className="text-sm text-admin-text-muted">
                {adminInlineText(lang, connection.required ? 'required' : 'optional')}
              </span>
            </span>,
            <span key={`${connection.id}:policy`}>
              {connection.authType} · {connection.secretSource}
              {Object.keys(connection.secretRefs).length > 0
                ? ` · refs: ${Object.keys(connection.secretRefs).join(', ')}`
                : ''}
              <span className="text-sm text-admin-text-muted">
                {connection.timeoutMs}ms · {connection.retry} · max{' '}
                {formatBytes(connection.maxResponseBytes, lang)}
              </span>
              <span className="text-sm text-admin-text-muted">
                {connection.healthCheck} · actor {connection.actorClaims ?? 'system'}
              </span>
            </span>,
            <span key={`${connection.id}:impact`} className="text-sm text-admin-text-muted">
              {connection.required
                ? adminInlineText(lang, 'required')
                : adminInlineText(lang, 'optional')}
              {connection.ownerType !== 'system' ? ` · ${connection.ownerType}` : ''}
            </span>,
            <span key={`${connection.id}:evidence`} className="text-sm text-admin-text-muted">
              {evidenceState} · {connection.lastTestAt ?? connection.policyUpdatedAt ?? 'never'}
              {connection.lastError ? ` · ${connection.lastError}` : ''}
            </span>,
            <div key={`${connection.id}:actions`} className="flex flex-wrap items-center gap-2">
              <Link
                href={adminRelatedHref(lang, '/admin/runs', {
                  q: connectionCorrelationKey(connection),
                })}
                className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
              >
                {adminInlineText(lang, 'Runs')}
              </Link>
              <Link
                href={adminRelatedHref(lang, '/admin/webhooks', {
                  q: connectionCorrelationKey(connection),
                })}
                className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
              >
                {adminInlineText(lang, 'Webhooks')}
              </Link>
              {testConnectionAction ? (
                <form action={testConnectionAction} className="inline-flex">
                  <input type="hidden" name="connectionId" value={connection.id} />
                  <input type="hidden" name="reason" value="Manual Admin service connection test" />
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    confirmation={adminInlineText(lang, 'test_connection_value_c12dd6aa', {
                      value1: connection.service,
                    })}
                  >
                    {adminInlineText(lang, 'Test')}
                  </ConfirmSubmitButton>
                </form>
              ) : null}
              {updateConnectionStatusAction ? (
                <form action={updateConnectionStatusAction} className="inline-flex">
                  <input type="hidden" name="connectionId" value={connection.id} />
                  <input
                    type="hidden"
                    name="status"
                    value={connection.status === 'disabled' ? 'active' : 'disabled'}
                  />
                  <input
                    type="hidden"
                    name="reason"
                    value={`Admin ${connection.status === 'disabled' ? 'enabled' : 'disabled'} connection ${connection.id}`}
                  />
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    confirmation={adminInlineText(lang, 'value_connection_value_61324463', {
                      value1: connection.status === 'disabled' ? 'Enable' : 'Disable',
                      value2: connection.service,
                    })}
                  >
                    {adminInlineText(lang, connection.status === 'disabled' ? 'Enable' : 'Disable')}
                  </ConfirmSubmitButton>
                </form>
              ) : null}
              {rotateConnectionSecretAction ? (
                <form action={rotateConnectionSecretAction} className="inline-flex">
                  <input type="hidden" name="connectionId" value={connection.id} />
                  <input
                    type="hidden"
                    name="secretSource"
                    value={`${connection.secretSource}:rotated`}
                  />
                  <input type="hidden" name="reason" value="Admin secret source rotation" />
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    confirmation={adminInlineText(
                      lang,
                      'rotate_the_secret_source_for_value_the_plaintext_sec_39b4e1e8',
                      { value1: connection.service }
                    )}
                  >
                    {adminInlineText(lang, 'Rotate')}
                  </ConfirmSubmitButton>
                </form>
              ) : null}
            </div>,
          ];
        })}
      />

      <div className="grid gap-1 xl:hidden">
        {filteredConnections.map((connection) => (
          <EntityListItem
            key={connection.id}
            href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(connection.id)}`)}
            title={connection.service}
            subtitle={connection.provider}
            status={connection.status}
            detail={`${connection.ownerType}/${connection.scopeType} · ${connection.required ? 'required' : 'optional'} · ${connection.lastTestAt ?? connection.policyUpdatedAt ?? 'never'}`}
            meta={connection.id}
            icon={Activity}
            density="compact"
            tone={
              connection.status === 'blocked'
                ? 'danger'
                : connection.status === 'warning'
                  ? 'warning'
                  : 'primary'
            }
          />
        ))}
      </div>
    </>
  );
}
