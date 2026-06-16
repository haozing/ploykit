import { DataTable } from '@host/components/ui';
import { EvidenceSection } from '@host/components/admin/shared/AdminPrimitives';
import { type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import { type AdminModuleDetailContract } from './ModuleDetailEvidenceModel';

export function ModuleContractExtensionEvidence({
  lang,
  contract,
}: {
  lang: SupportedLanguage;
  contract: AdminModuleDetailContract;
}) {
  return (
    <EvidenceSection
      title={adminInlineText(lang, 'Surfaces and resources')}
      description={adminInlineText(
        lang,
        'Navigation, surfaces, and provider requirements are extension evidence, not the primary page story.'
      )}
    >
      <div className="grid gap-4">
        <DataTable
          className="shadow-none"
          columns={adminInlineColumns(lang, ['Surface / Navigation', 'Mode', 'Target'])}
          rows={
            contract && (contract.surfaces.length > 0 || contract.navigation.length > 0)
              ? [
                  ...contract.navigation.map((item) => [
                    `nav:${item.location}`,
                    'link',
                    `${item.label} -> ${item.path}`,
                  ]),
                  ...contract.surfaces.map((item) => [
                    `surface:${item.id}`,
                    item.mode,
                    item.component,
                  ]),
                ]
              : [['none', 'none', 'module does not contribute navigation or surfaces']]
          }
          minWidthClass="min-w-[740px]"
          density="compact"
        />
        <DataTable
          className="shadow-none"
          columns={adminInlineColumns(lang, ['Resource', 'Required', 'Detail'])}
          rows={
            contract && contract.requirements.length > 0
              ? contract.requirements.map((item) => [
                  `${item.kind}:${item.name}`,
                  item.required ? 'required' : 'optional',
                  [item.provider, item.description].filter(Boolean).join(' · ') || 'declared',
                ])
              : [['none', 'no', 'module has no service/resource binding requirements']]
          }
          minWidthClass="min-w-[740px]"
          density="compact"
        />
      </div>
    </EvidenceSection>
  );
}
