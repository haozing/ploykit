import { DataTable } from '@host/components/ui';
import { EvidenceSection } from '@host/components/admin/shared/AdminPrimitives';
import { type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminModuleDetailView } from '@host/lib/admin-module-operations';
import {
  joinOrNone,
  type AdminModuleDetailContract,
  type AdminModuleDetailModule,
} from './ModuleDetailEvidenceModel';
import { ModuleContractExtensionEvidence } from './ModuleContractExtensionEvidence';
import { ModuleContractGatewayEvidence } from './ModuleContractGatewayEvidence';
import { ModuleContractRiskEvidence } from './ModuleContractRiskEvidence';

export function ModuleContractEvidence({
  lang,
  detail,
  module,
  contract,
}: {
  lang: SupportedLanguage;
  detail: AdminModuleDetailView;
  module: AdminModuleDetailModule;
  contract: AdminModuleDetailContract;
}) {
  return (
    <>
      {contract ? <ModuleContractRiskEvidence lang={lang} contract={contract} /> : null}

      <EvidenceSection
        title={adminInlineText(lang, 'Capability map')}
        description={adminInlineText(lang, 'Product-facing capabilities before raw contract details.')}
        defaultOpen
      >
        <div className="grid gap-4">
          <DataTable
            className="shadow-none"
            columns={adminInlineColumns(lang, ['Capability', 'Count', 'Notes'])}
            rows={[
              [
                'Routes',
                String(module.capabilities.routes),
                `${module.capabilities.siteRoutes} site / ${module.capabilities.dashboardRoutes} dashboard / ${module.capabilities.adminRoutes} admin / ${module.capabilities.apiRoutes} api`,
              ],
              [
                'Actions',
                String(module.capabilities.actions),
                contract ? joinOrNone(contract.actions.map((item) => item.name)) : 'none',
              ],
              [
                'Jobs',
                String(module.capabilities.jobs),
                contract ? joinOrNone(contract.jobs.map((item) => item.name)) : 'none',
              ],
              [
                'Events',
                String(module.capabilities.events),
                contract
                  ? `${contract.events.publishes.length} publishes / ${contract.events.subscribes.length} subscribes`
                  : 'none',
              ],
              [
                'Webhooks',
                String(module.capabilities.webhooks),
                contract ? joinOrNone(contract.webhooks.map((item) => item.name)) : 'none',
              ],
              [
                'Data',
                String(module.capabilities.dataTables + module.capabilities.dataDocuments),
                contract
                  ? `${joinOrNone(contract.data.tables)} tables / ${joinOrNone(contract.data.documents)} documents / ${joinOrNone(contract.data.views)} views / ${joinOrNone(contract.data.grants)} grants / ${joinOrNone(contract.data.checks)} checks / ${contract.data.migrationMode ?? 'no migration mode'}`
                  : 'none',
              ],
            ]}
            minWidthClass="min-w-[760px]"
            density="compact"
          />
          <DataTable
            className="shadow-none"
            columns={adminInlineColumns(lang, [
              'Summary channel',
              'Runtime contract',
              'Map release evidence',
            ])}
            rows={[
              [
                'Provider requirements',
                `${module.runtimeSummary.providerRequirements.services.length} services / ${module.runtimeSummary.providerRequirements.resourceBindings.length} resources / ${module.runtimeSummary.providerRequirements.egressOrigins.length} egress`,
                module.contractMeta.capabilitySummary
                  ? `${module.contractMeta.capabilitySummary.providerRequirements} map requirements`
                  : 'missing map summary',
              ],
              [
                'Commercial',
                `${module.runtimeSummary.commercialRequirements.meters.length} meters / ${module.runtimeSummary.commercialRequirements.routeEntitlements.length + module.runtimeSummary.commercialRequirements.actionEntitlements.length} entitlements`,
                module.contractMeta.capabilitySummary
                  ? `${module.contractMeta.capabilitySummary.commercialRequirements} map requirements`
                  : 'missing map summary',
              ],
              [
                'Presentation',
                `${module.runtimeSummary.presentationContribution.surfaces.length} surfaces / ${module.runtimeSummary.presentationContribution.replaces.length} replacements / ${module.runtimeSummary.presentationContribution.i18nNamespaces.length} namespaces`,
                module.contractMeta.capabilitySummary
                  ? `${module.contractMeta.capabilitySummary.presentationContributions} map contributions`
                  : 'missing map summary',
              ],
            ]}
            minWidthClass="min-w-[860px]"
            density="compact"
          />
        </div>
      </EvidenceSection>

      <EvidenceSection
        title={adminInlineText(lang, 'Module root and release metadata')}
        description={adminInlineText(
          lang,
          'Generated module-map evidence explains whether module files, contract, and release metadata still match.'
        )}
      >
        <DataTable
          className="shadow-none"
          columns={adminInlineColumns(lang, ['Field', 'Value', 'Evidence'])}
          rows={[
            ['Module root', module.contractMeta.rootDir ?? 'unknown', 'workspace modules directory'],
            [
              'Build ID',
              module.contractMeta.buildId ?? 'missing',
              contract?.release?.generatedAt ?? 'no generatedAt',
            ],
            [
              'Source hash',
              module.contractMeta.sourceHash ?? 'missing',
              `${module.contractMeta.sourceFiles} source files`,
            ],
            [
              'Contract digest',
              module.contractMeta.contractDigest ?? 'missing',
              'module.ts contract digest',
            ],
            [
              'Contract parts',
              contract && contract.parts.length > 0
                ? contract.parts.map((part) => `${part.name}:${part.path}`).join(', ')
                : 'none',
              'parts are optional local split files wired back into module.ts',
            ],
          ]}
          minWidthClass="min-w-[900px]"
          density="compact"
        />
      </EvidenceSection>

      <ModuleContractGatewayEvidence
        lang={lang}
        detail={detail}
        module={module}
        contract={contract}
      />
      <ModuleContractExtensionEvidence lang={lang} contract={contract} />
    </>
  );
}
