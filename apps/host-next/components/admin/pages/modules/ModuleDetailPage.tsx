import Link from 'next/link';
import {
  adminNav,
  EmptyState,
  StatCard,
  WorkspaceShell,
} from '@host/components/ProductShell';
import { DetailDrawer } from '@host/components/ui';
import { CopyButton } from '@host/components/ui/CopyButton';
import {
  AdminPanel,
  CodeBlockPanel,
  FactList,
  HealthRowList,
  StatGrid,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminModuleDetailCopy } from '@host/lib/admin-copy';
import type { AdminModuleDetailView } from '@host/lib/admin-module-operations';
import { ModuleDetailEvidence } from './ModuleDetailEvidence';
import { ModuleOperationalMetadataPanel } from './ModuleOperationalMetadataPanel';
import { ModuleProductShapePanel } from './ModuleProductShapePanel';
import {
  getModuleCapabilityPhrases,
  getModuleCategory,
  getModuleOperatorNextAction,
  getModuleProductArea,
  getModuleReleaseImpact,
  moduleProductAreaDetails,
} from './ModulePageModel';

function compactJson(value: unknown, maxLength = Number.POSITIVE_INFINITY): string {
  if (value === undefined) {
    return '';
  }
  const text = JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

export function AdminModuleDetailOperationsPage({
  lang,
  detail,
}: {
  lang: SupportedLanguage;
  detail: AdminModuleDetailView;
}) {
  const copy = getAdminModuleDetailCopy(lang);
  const module = detail.module;
  const contract = detail.contract;
  const diagnostics = detail.presentedDiagnostics;
  const capabilityPhrases = module ? getModuleCapabilityPhrases(module) : [];
  const releaseImpact = module ? getModuleReleaseImpact(lang, module) : null;
  return (
    <WorkspaceShell
      lang={lang}
      title={module?.name ?? copy.detailTitle}
      subtitle={copy.subtitle}
      nav={adminNav}
    >
      {module ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-wrap items-center gap-2 xl:col-span-2">
            <Link
              href={localizedPath(lang, '/admin/modules')}
              className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {adminInlineText(lang, 'Back to modules')}
            </Link>
            <Link
              href={`${localizedPath(lang, '/admin/module-dev-console')}?moduleId=${encodeURIComponent(module.id)}`}
              className="inline-flex min-h-9 items-center justify-center rounded-admin-md bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {adminInlineText(lang, 'Open dev console')}
            </Link>
          </div>
          <div className="grid gap-5">
            <StatGrid>
              <StatCard
                label={adminInlineText(lang, 'Catalog')}
                value={module.status}
                tone={module.status === 'enabled' ? 'blue' : 'amber'}
              />
              <StatCard
                label={adminInlineText(lang, 'Runtime')}
                value={module.runtimeState}
                tone={module.runtimeState === 'error' ? 'red' : 'blue'}
              />
              <StatCard
                label={adminInlineText(lang, 'Health')}
                value={module.health.status}
                tone={
                  module.health.errors > 0 ? 'red' : module.health.warnings > 0 ? 'amber' : 'blue'
                }
              />
              <StatCard
                label={adminInlineText(lang, 'Permissions')}
                value={String(module.permissions.length)}
                tone="amber"
              />
            </StatGrid>

            <AdminPanel
              title={adminInlineText(lang, 'Capability narrative')}
              description={adminInlineText(
                lang,
                'This turns the module contract into product-language impact before showing raw evidence.'
              )}
              contentClassName="grid gap-4"
            >
              <HealthRowList
                lang={lang}
                items={[
                  {
                    key: 'product-area',
                    title: getModuleProductArea(module),
                    detail:
                      moduleProductAreaDetails[getModuleProductArea(module)] ??
                      moduleProductAreaDetails.Platform,
                    meta: getModuleCategory(module),
                    status: module.status,
                    statusTone:
                      module.status === 'enabled'
                        ? 'success'
                        : module.status === 'not_installed'
                          ? 'neutral'
                          : 'warning',
                    tone: 'primary',
                  },
                  {
                    key: 'release-impact',
                    title: releaseImpact?.label ?? 'Unknown release impact',
                    detail: releaseImpact?.detail ?? 'No release impact evidence available.',
                    meta: getModuleOperatorNextAction(lang, module),
                    status: releaseImpact?.status ?? 'unknown',
                    statusLabel: releaseImpact?.label,
                    statusTone: releaseImpact?.tone,
                    tone: releaseImpact?.tone ?? 'neutral',
                  },
                ]}
              />
              <FactList
                lang={lang}
                density="compact"
                items={[
                  {
                    label: adminInlineText(lang, 'product_capabilities_c63c578c'),
                    value: capabilityPhrases.join(' · '),
                    helper: adminInlineText(
                      lang,
                      'human_readable_phrases_derived_from_routes_surfaces__eca5b552'
                    ),
                  },
                  {
                    label: adminInlineText(lang, 'operator_next_action_1f0c6789'),
                    value: getModuleOperatorNextAction(lang, module),
                    helper: adminInlineText(
                      lang,
                      'the_next_action_is_derived_from_install_state_lifecy_837e1098'
                    ),
                    tone: releaseImpact?.tone ?? 'neutral',
                  },
                  {
                    label: adminInlineText(lang, 'release_candidate_impact_71d4c09e'),
                    value:
                      releaseImpact?.detail ??
                      adminInlineText(lang, 'no_release_impact_evidence_available_bfb7c0f6'),
                    helper: adminInlineText(
                      lang,
                      'use_this_before_enabling_traffic_or_preparing_rc_evi_d0b8a4a9'
                    ),
                  },
                ]}
              />
            </AdminPanel>

            <ModuleProductShapePanel lang={lang} module={module} copy={copy} />
            <ModuleOperationalMetadataPanel lang={lang} module={module} contract={contract} />

            <ModuleDetailEvidence
              lang={lang}
              detail={detail}
              module={module}
              contract={contract}
              diagnostics={diagnostics}
            />

            <CodeBlockPanel
              lang={lang}
              title={adminInlineText(lang, 'AI fix prompt')}
              description={adminInlineText(
                lang,
                'Copy this prompt when a module needs targeted doctor remediation.'
              )}
              value={diagnostics.aiFixPrompt}
              copyValue={diagnostics.aiFixPrompt}
            />
          </div>

          <DetailDrawer
            open
            title={adminInlineText(lang, 'Module snapshot')}
            description={module.id}
            actions={
              <CopyButton
                value={module.id}
                label={adminInlineText(lang, 'Copy ID')}
                copiedLabel={adminInlineText(lang, 'Copied ID')}
              />
            }
            className="xl:sticky xl:top-24 xl:self-start"
          >
            <FactList
              lang={lang}
              items={[
                { label: 'Module ID', value: module.id, copyValue: module.id, mono: true },
                { label: 'Description', value: module.description ?? 'none' },
                { label: 'Version', value: module.version },
                { label: 'Installed', value: module.installed ? 'yes' : 'no' },
                { label: 'Required', value: module.required ? 'yes' : 'no' },
                { label: 'Root', value: contract?.rootDir ?? 'unknown', mono: true },
                { label: 'Permissions', value: module.permissions.join(', ') || 'none' },
                { label: 'Catalog', value: compactJson(detail.catalogState ?? {}), mono: true },
              ]}
            />
          </DetailDrawer>
        </div>
      ) : (
        <EmptyState title={copy.missingTitle}>{copy.missingBody}</EmptyState>
      )}
    </WorkspaceShell>
  );
}
