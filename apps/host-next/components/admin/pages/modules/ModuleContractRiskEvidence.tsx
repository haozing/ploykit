import { DataTable } from '@host/components/ui';
import { EvidenceSection, HealthRowList } from '@host/components/admin/shared/AdminPrimitives';
import { type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import { joinOrNone, type AdminModuleDetailContract } from './ModuleDetailEvidenceModel';

export function ModuleContractRiskEvidence({
  lang,
  contract,
}: {
  lang: SupportedLanguage;
  contract: NonNullable<AdminModuleDetailContract>;
}) {
  return (
    <EvidenceSection
      title={adminInlineText(lang, 'Risk review')}
      description={adminInlineText(
        lang,
        'High-risk permissions, external entrypoints, secrets, and required resources are summarized before raw contract detail.'
      )}
      defaultOpen={contract.risk.score > 0}
    >
      <div className="grid gap-4">
        <DataTable
          className="shadow-none"
          columns={adminInlineColumns(lang, ['Risk area', 'Count', 'Evidence'])}
          rows={[
            [
              'High-risk permissions',
              String(contract.risk.highRiskPermissions.length),
              contract.risk.highRiskPermissions.length > 0
                ? contract.risk.highRiskPermissions
                    .map((permission) => `${permission.value}:${permission.risk}`)
                    .join(', ')
                : 'none',
            ],
            [
              'System-only permissions',
              String(contract.risk.systemPermissions.length),
              joinOrNone(contract.risk.systemPermissions),
            ],
            [
              'External egress',
              String(contract.risk.externalEgress.length),
              joinOrNone(contract.risk.externalEgress),
            ],
            [
              'Public APIs',
              String(contract.risk.publicApis.length),
              contract.risk.publicApis.length > 0
                ? contract.risk.publicApis
                    .map(
                      (route) =>
                        `${route.methods.join('|')} ${route.path}${route.anonymousPolicy ? ' policy' : ''}`
                    )
                    .join(', ')
                : 'none',
            ],
            [
              'Webhooks',
              String(contract.risk.webhooks.length),
              contract.risk.webhooks.length > 0
                ? contract.risk.webhooks
                    .map((webhook) => `${webhook.name}:${webhook.signature}`)
                    .join(', ')
                : 'none',
            ],
            [
              'Presentation overrides',
              String(contract.risk.presentationOverrides.length),
              joinOrNone(contract.risk.presentationOverrides),
            ],
            [
              'Secrets and required resources',
              String(contract.risk.secretConfig.length + contract.risk.requiredRequirements.length),
              joinOrNone([...contract.risk.secretConfig, ...contract.risk.requiredRequirements]),
            ],
          ]}
          minWidthClass="min-w-[920px]"
          density="compact"
        />
        <HealthRowList
          lang={lang}
          items={[
            {
              key: 'risk-score',
              title: 'Module risk score',
              detail:
                contract.risk.score > 0
                  ? 'Review the risk evidence before enabling or accepting release-candidate traffic.'
                  : 'No high-risk contract signals were found in the current module contract.',
              meta: String(contract.risk.score),
              status:
                contract.risk.score > 8 ? 'high' : contract.risk.score > 0 ? 'review' : 'clear',
              statusTone:
                contract.risk.score > 8
                  ? 'danger'
                  : contract.risk.score > 0
                    ? 'warning'
                    : 'success',
              tone:
                contract.risk.score > 8
                  ? 'danger'
                  : contract.risk.score > 0
                    ? 'warning'
                    : 'success',
            },
          ]}
        />
      </div>
    </EvidenceSection>
  );
}
