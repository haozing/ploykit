import { DataTable } from '@host/components/ui';
import { EvidenceSection } from '@host/components/admin/shared/AdminPrimitives';
import { type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminModuleDetailView } from '@host/lib/admin-module-operations';
import {
  joinOrNone,
  type AdminModuleDetailDiagnostics,
  type AdminModuleDetailModule,
} from './ModuleDetailEvidenceModel';

export function ModuleRuntimeDiagnosticsEvidence({
  lang,
  detail,
  module,
  diagnostics,
}: {
  lang: SupportedLanguage;
  detail: AdminModuleDetailView;
  module: AdminModuleDetailModule;
  diagnostics: AdminModuleDetailDiagnostics;
}) {
  return (
    <>
      <EvidenceSection
        title={adminInlineText(lang, 'Runtime activity')}
        description={adminInlineText(lang, 'Recent module records are summarized before raw diagnostics.')}
      >
        <DataTable
          className="shadow-none"
          columns={adminInlineColumns(lang, ['Runtime Record', 'Count', 'Latest / Failed'])}
          rows={[
            ['Runs', String(detail.recent.runs.length), `${module.activity.failedRuns} failed`],
            ['Outbox', String(module.activity.outbox), `${module.activity.failedOutbox} failed/dead`],
            [
              'Webhook receipts',
              String(module.activity.webhookReceipts),
              `${module.activity.failedWebhookReceipts} failed/rejected`,
            ],
            [
              'Usage',
              String(module.activity.usageRecords),
              joinOrNone(detail.recent.usageRecords.map((record) => record.meter)),
            ],
            [
              'Files',
              String(module.activity.files),
              joinOrNone(detail.recent.files.map((file) => file.status)),
            ],
          ]}
          minWidthClass="min-w-[760px]"
          density="compact"
        />
      </EvidenceSection>

      <EvidenceSection
        title={`Diagnostics · ${detail.diagnostics.length}`}
        description={adminInlineText(lang, 'Doctor output stays below product and runtime summaries.')}
      >
        <div className="grid gap-4">
          <DataTable
            className="shadow-none"
            columns={adminInlineColumns(lang, ['Subsystem', 'Errors', 'Warnings'])}
            rows={
              detail.diagnostics.length > 0
                ? Array.from(
                    detail.diagnostics.reduce((groups, item) => {
                      const key = `${item.category ?? 'contract'}:${item.subsystem ?? 'module'}`;
                      const existing = groups.get(key) ?? { errors: 0, warnings: 0 };
                      if (item.severity === 'error') {
                        existing.errors += 1;
                      }
                      if (item.severity === 'warning') {
                        existing.warnings += 1;
                      }
                      groups.set(key, existing);
                      return groups;
                    }, new Map<string, { errors: number; warnings: number }>())
                  ).map(([key, value]) => [key, String(value.errors), String(value.warnings)])
                : [['contract:module', '0', '0']]
            }
            minWidthClass="min-w-[700px]"
            density="compact"
          />
          <DataTable
            className="shadow-none"
            columns={adminInlineColumns(lang, ['Severity', 'Code', 'Location / Fix'])}
            rows={
              detail.diagnostics.length > 0
                ? detail.diagnostics.map((item) => [
                    item.severity,
                    item.code,
                    [
                      item.path,
                      item.line ? `L${item.line}${item.column ? `:${item.column}` : ''}` : null,
                      item.category && item.subsystem
                        ? `${item.category}/${item.subsystem}`
                        : null,
                      item.fix ?? item.message,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  ])
                : [['ok', 'MODULE_DOCTOR_CLEAN', 'No module-specific diagnostics']]
            }
            minWidthClass="min-w-[760px]"
            density="compact"
          />
          <DataTable
            className="shadow-none"
            columns={adminInlineColumns(lang, ['Presenter', 'Count', 'Meaning'])}
            rows={[
              ['Errors', String(diagnostics.errors.length), 'Must be fixed before risky release paths'],
              ['Warnings', String(diagnostics.warnings.length), 'Should be fixed for RC evidence'],
              ['Infos', String(diagnostics.infos.length), 'Informational only'],
            ]}
            minWidthClass="min-w-[700px]"
            density="compact"
          />
        </div>
      </EvidenceSection>
    </>
  );
}
