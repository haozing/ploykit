import { DataTable } from '@host/components/ui';
import { EvidenceSection } from '@host/components/admin/shared/AdminPrimitives';
import { type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminModuleDetailView } from '@host/lib/admin-module-operations';
import {
  type AdminModuleDetailContract,
  type AdminModuleDetailModule,
} from './ModuleDetailEvidenceModel';

export function ModuleContractGatewayEvidence({
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
    <EvidenceSection
      title={`Routes and gateways · ${detail.routes.length}`}
      description={adminInlineText(lang, 'Routes are grouped with the host gateways that expose them.')}
    >
      <div className="grid gap-4">
        <DataTable
          className="shadow-none"
          columns={adminInlineColumns(lang, ['Kind', 'Path', 'Auth'])}
          rows={detail.routes.map((route) => [route.kind, route.path, route.auth])}
          empty={adminInlineText(lang, 'No module routes declared.')}
          minWidthClass="min-w-[720px]"
          density="compact"
        />
        <DataTable
          className="shadow-none"
          columns={adminInlineColumns(lang, ['Gateway', 'Status', 'Contract'])}
          rows={[
            [
              '/api/modules/[...path]',
              module.capabilities.apiRoutes > 0 ? 'mounted' : 'not declared',
              module.capabilities.apiRoutes > 0
                ? `${module.capabilities.apiRoutes} API routes; auth/rate/anonymousPolicy follows the module route contract`
                : 'no module API routes',
            ],
            [
              '/api/module-webhooks/[...path]',
              module.capabilities.webhooks > 0 ? 'mounted' : 'not declared',
              contract
                ? contract.webhooks
                    .map((webhook) => `${webhook.name}:${webhook.signature}`)
                    .join(', ') || 'no webhooks'
                : 'no contract',
            ],
            [
              '/[lang]/admin/[...modulePath]',
              module.capabilities.adminRoutes > 0 ? 'admin routes declared' : 'not declared',
              module.capabilities.adminRoutes > 0
                ? 'Rendered through the host Admin shell from routes.admin'
                : 'no module admin runtime route',
            ],
          ]}
          minWidthClass="min-w-[820px]"
          density="compact"
        />
      </div>
    </EvidenceSection>
  );
}
