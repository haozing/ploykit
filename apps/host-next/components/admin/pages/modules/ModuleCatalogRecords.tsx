import Link from 'next/link';
import { Box } from 'lucide-react';
import { ConfirmSubmitButton, DataTable } from '@host/components/ui';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import { EntityListItem, MoreActionMenu } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import {
  getModuleCapabilityPhrases,
  getModuleCategory,
  getModuleOperatorNextAction,
  getModuleProductArea,
  getModuleReleaseImpact,
  type AdminModuleListItem,
} from './ModulePageModel';
import type { AdminFormAction } from './ModuleCatalogPageModel';

export function ModuleCatalogRecords({
  lang,
  visibleModules,
  updateModuleStatusAction,
}: {
  lang: SupportedLanguage;
  visibleModules: readonly AdminModuleListItem[];
  updateModuleStatusAction: AdminFormAction;
}) {
  return (
    <>
      <div className="hidden xl:block">
        <DataTable
          className="rounded-none border-x-0 border-b-0 shadow-none"
          density="compact"
          columns={adminInlineColumns(lang, [
            'Module',
            'Product Area',
            'Lifecycle',
            'Health',
            'Capabilities',
            'Activity',
            'Action',
          ])}
          rows={visibleModules.map((module) => {
            const nextStatus = module.status === 'enabled' ? 'disabled' : 'enabled';
            const actionLabel =
              module.status === 'not_installed'
                ? 'Install'
                : nextStatus === 'enabled'
                  ? 'Enable'
                  : 'Disable';
            const statusActionBlocked = module.required && nextStatus !== 'enabled';
            const impact = [
              `${module.capabilities.routes} routes`,
              `${module.capabilities.actions} actions`,
              `${module.capabilities.jobs} jobs`,
              `${module.capabilities.webhooks} webhooks`,
              `${module.capabilities.dataTables + module.capabilities.dataDocuments} data objects`,
            ].join(', ');
            const failures =
              module.activity.failedRuns +
              module.activity.failedOutbox +
              module.activity.failedWebhookReceipts;
            const capabilityPhrases = getModuleCapabilityPhrases(module);
            const releaseImpact = getModuleReleaseImpact(lang, module);
            return [
              <div key={`${module.id}:module`} className="min-w-0">
                <Link
                  href={localizedPath(lang, `/admin/modules/${module.id}`)}
                  className="block truncate font-semibold text-admin-primary hover:underline"
                >
                  {module.name}
                </Link>
                <div className="mt-1 truncate text-xs text-admin-text-muted">
                  {module.id} · v{module.version}
                  {module.required ? ' · required' : ''}
                </div>
              </div>,
              <div key={`${module.id}:area`} className="grid gap-1">
                <span className="text-sm font-semibold text-admin-text">
                  {getModuleProductArea(module)}
                </span>
                <span className="text-xs text-admin-text-muted">{getModuleCategory(module)}</span>
              </div>,
              <div key={`${module.id}:lifecycle`} className="grid gap-1">
                <StatusBadge lang={lang} value={module.status} />
                <span className="text-xs text-admin-text-muted">
                  {adminInlineText(lang, module.installed ? 'persisted' : 'not installed')}
                </span>
              </div>,
              <div key={`${module.id}:health`} className="grid gap-1">
                <StatusBadge lang={lang} value={module.runtimeState} />
                <span className="text-xs text-admin-text-muted">
                  {adminInlineText(lang, 'value_errors_value_warnings_52368790', {
                    value1: module.health.errors,
                    value2: module.health.warnings,
                  })}
                </span>
              </div>,
              <div key={`${module.id}:capabilities`} className="text-sm text-admin-text">
                {capabilityPhrases.slice(0, 2).join(' · ')}
                <div className="mt-1 text-xs leading-5 text-admin-text-muted">
                  {capabilityPhrases.slice(2, 5).join(' · ') ||
                    getModuleOperatorNextAction(lang, module)}
                </div>
              </div>,
              <div key={`${module.id}:activity`} className="text-sm text-admin-text">
                <StatusBadge
                  lang={lang}
                  value={releaseImpact.status}
                  label={releaseImpact.label}
                  tone={releaseImpact.tone}
                />
                <div className="mt-1 text-xs text-admin-text-muted">
                  {adminInlineText(lang, 'value_failures_value_99e0a2ec', {
                    value1: failures,
                    value2: getModuleOperatorNextAction(lang, module),
                  })}
                </div>
              </div>,
              <div key={`${module.id}:actions`} className="flex flex-wrap items-center gap-2">
                {statusActionBlocked ? (
                  <StatusBadge
                    lang={lang}
                    value="guarded"
                    label={adminInlineText(lang, 'Required')}
                    tone="info"
                  />
                ) : (
                  <form action={updateModuleStatusAction} className="inline-flex">
                    <input type="hidden" name="moduleId" value={module.id} />
                    <input type="hidden" name="status" value={nextStatus} />
                    <input
                      type="hidden"
                      name="reason"
                      value={`Admin ${actionLabel.toLowerCase()} from module list. Impact: ${impact}.`}
                    />
                    <ConfirmSubmitButton
                      type="submit"
                      className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                      confirmation={adminInlineText(
                        lang,
                        'value_module_value_impact_value_075dd98f',
                        { value1: actionLabel, value2: module.name, value3: impact }
                      )}
                    >
                      {adminInlineText(lang, actionLabel)}
                    </ConfirmSubmitButton>
                  </form>
                )}
                {module.status === 'enabled' && !module.required ? (
                  <MoreActionMenu label={adminInlineText(lang, 'Maintain')}>
                    <form action={updateModuleStatusAction}>
                      <input type="hidden" name="moduleId" value={module.id} />
                      <input type="hidden" name="status" value="maintenance" />
                      <input
                        type="hidden"
                        name="reason"
                        value={`Admin moved ${module.id} to maintenance from module list. Impact: ${impact}.`}
                      />
                      <ConfirmSubmitButton
                        type="submit"
                        className="inline-flex w-full min-h-8 items-center justify-center rounded-admin-md border border-admin-warning/25 bg-admin-warning/10 px-3 py-1.5 text-xs font-semibold text-admin-warning transition hover:bg-admin-warning/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                        confirmation={adminInlineText(
                          lang,
                          'move_value_to_maintenance_mode_impact_value_28a88ab6',
                          { value1: module.name, value2: impact }
                        )}
                      >
                        {adminInlineText(lang, 'Move to maintenance')}
                      </ConfirmSubmitButton>
                    </form>
                  </MoreActionMenu>
                ) : null}
              </div>,
            ];
          })}
          empty={adminInlineText(lang, 'No modules match this filter.')}
          minWidthClass="min-w-[1260px]"
        />
      </div>
      <div className="grid gap-1 px-2 py-2 xl:hidden">
        {visibleModules.length > 0 ? (
          visibleModules.map((module) => {
            const failures =
              module.activity.failedRuns +
              module.activity.failedOutbox +
              module.activity.failedWebhookReceipts;
            return (
              <EntityListItem
                key={module.id}
                href={localizedPath(lang, `/admin/modules/${module.id}`)}
                title={module.name}
                subtitle={`${module.id} · v${module.version}`}
                status={module.runtimeState}
                detail={adminInlineText(lang, 'value_value_value_failures_282222ec', {
                  value1: getModuleProductArea(module),
                  value2: getModuleCapabilityPhrases(module).slice(0, 2).join(' · '),
                  value3: failures,
                })}
                meta={module.status}
                icon={Box}
                density="compact"
                tone={
                  module.runtimeState === 'error' || failures > 0
                    ? 'danger'
                    : module.runtimeState === 'blocked'
                      ? 'warning'
                      : 'primary'
                }
              />
            );
          })
        ) : (
          <div className="rounded-admin-md border border-dashed border-admin-border px-4 py-8 text-center text-sm text-admin-text-muted">
            {adminInlineText(lang, 'No modules match this filter.')}
          </div>
        )}
      </div>
    </>
  );
}
