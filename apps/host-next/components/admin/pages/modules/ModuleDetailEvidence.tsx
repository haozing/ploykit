import { AdminPanel } from '@host/components/admin/shared/AdminPrimitives';
import { type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminModuleDetailView } from '@host/lib/admin-module-operations';
import {
  type AdminModuleDetailContract,
  type AdminModuleDetailDiagnostics,
  type AdminModuleDetailModule,
} from './ModuleDetailEvidenceModel';
import { ModuleContractEvidence } from './ModuleContractEvidence';
import { ModuleRuntimeDiagnosticsEvidence } from './ModuleRuntimeDiagnosticsEvidence';

export function ModuleDetailEvidence({
  lang,
  detail,
  module,
  contract,
  diagnostics,
}: {
  lang: SupportedLanguage;
  detail: AdminModuleDetailView;
  module: AdminModuleDetailModule;
  contract: AdminModuleDetailContract;
  diagnostics: AdminModuleDetailDiagnostics;
}) {
  return (
    <AdminPanel
      title={adminInlineText(lang, 'Contract and runtime evidence')}
      description={adminInlineText(
        lang,
        'The module detail page keeps the product summary visible first. Raw contract, gateway, resource, activity, and doctor evidence stays folded by task.'
      )}
      contentClassName="grid gap-3"
    >
      <ModuleContractEvidence lang={lang} detail={detail} module={module} contract={contract} />
      <ModuleRuntimeDiagnosticsEvidence
        lang={lang}
        detail={detail}
        module={module}
        diagnostics={diagnostics}
      />
    </AdminPanel>
  );
}
