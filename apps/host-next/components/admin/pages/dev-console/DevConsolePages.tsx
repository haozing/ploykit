import type { ReactNode } from 'react';
import { Boxes, FileCode2, LayoutTemplate, TriangleAlert } from 'lucide-react';
import { adminNav, StatCard, WorkspaceShell } from '@host/components/ProductShell';
import { ActionPanel, ActionQueue, StatGrid } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminDevConsoleCopy } from '@host/lib/admin-copy';
import type {
  ProductCompositionView,
  ProductThemeDiagnosticsView,
} from '@host/lib/product-composition';
import type { AdminModuleDevConsoleView } from '@host/lib/admin-module-dev-console';
import { DevConsoleEnvironmentPanel } from './DevConsoleEnvironmentPanel';
import { DevConsoleOperationsSummary } from './DevConsoleOperationsSummary';
import { DevConsoleOwnerPanel } from './DevConsoleOwnerPanel';
import { DevConsoleRawDiagnostics } from './DevConsoleRawDiagnostics';
import { DevConsoleRepairPanel } from './DevConsoleRepairPanel';

export function AdminModuleDevConsoleOperationsPage({
  lang,
  view,
  composition,
  theme,
  diagnosticsPanel,
}: {
  lang: SupportedLanguage;
  view: AdminModuleDevConsoleView;
  composition?: ProductCompositionView;
  theme?: ProductThemeDiagnosticsView;
  diagnosticsPanel?: ReactNode;
}) {
  const copy = getAdminDevConsoleCopy(lang);
  const diagnosticItems = view.report.modulesWithErrors.slice(0, 4).map((moduleId) => ({
    key: moduleId,
    title: moduleId,
    description:
      (view.diagnosticsByModule[moduleId] ?? [])
        .slice(0, 2)
        .map((item) => `${item.code}: ${item.message}`)
        .join(' · ') || 'Module has errors in the latest diagnostics report.',
    actionLabel: copy.openModule,
    href: localizedPath(lang, `/admin/modules/${moduleId}`),
    status: 'failed',
    tone: 'danger' as const,
  }));
  const diagnosticQueueItems =
    diagnosticItems.length > 0
      ? diagnosticItems
      : [
          {
            key: 'diagnostics-clear',
            title: adminInlineText(lang, 'No blocking module diagnostics'),
            description: adminInlineText(
              lang,
              'Latest module doctor evidence has no blocking errors; raw tables remain available below.'
            ),
            actionLabel: adminInlineText(lang, 'Open modules'),
            href: localizedPath(lang, '/admin/modules'),
            status: 'ready',
            tone: 'success' as const,
          },
        ];

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <StatGrid>
        <StatCard
          label={adminInlineText(lang, 'Modules')}
          value={String(view.snapshot.moduleCount)}
          helper={adminInlineText(lang, 'Runtime snapshot')}
          tone="blue"
          icon={Boxes}
        />
        <StatCard
          label={adminInlineText(lang, 'Bundle')}
          value={String(view.bundle.modules.length)}
          helper={adminInlineText(lang, 'Scanned module sources')}
          icon={FileCode2}
        />
        <StatCard
          label={adminInlineText(lang, 'Errors')}
          value={String(view.report.modulesWithErrors.length)}
          helper={adminInlineText(lang, 'Doctor diagnostics')}
          tone={view.report.modulesWithErrors.length > 0 ? 'red' : 'neutral'}
          icon={TriangleAlert}
        />
        <StatCard
          label={adminInlineText(lang, 'Templates')}
          value={String(view.report.templates.length)}
          helper={adminInlineText(lang, 'Available scaffolds')}
          tone="amber"
          icon={LayoutTemplate}
        />
      </StatGrid>

      <ActionPanel
        title={
          diagnosticItems.length > 0
            ? adminInlineText(lang, 'Diagnostics need review')
            : adminInlineText(lang, 'Diagnostics clear')
        }
        description={
          diagnosticItems.length > 0
            ? adminInlineText(
                lang,
                'Module errors are promoted before raw diagnostic tables so the first screen has a concrete next action.'
              )
            : adminInlineText(
                lang,
                'This page intentionally keeps raw module evidence available below, but the first screen now starts with the diagnostic conclusion.'
              )
        }
        tone={diagnosticItems.length > 0 ? 'danger' : 'success'}
      />

      <ActionQueue
        lang={lang}
        title={adminInlineText(lang, 'Diagnostics review')}
        description={adminInlineText(
          lang,
          'This page may expose raw diagnostics, but module errors still get a clear first action.'
        )}
        status={diagnosticItems.length > 0 ? 'failed' : 'ready'}
        items={diagnosticQueueItems}
      />

      <DevConsoleEnvironmentPanel lang={lang} view={view} />
      <DevConsoleOwnerPanel lang={lang} view={view} />
      <DevConsoleRepairPanel lang={lang} view={view} />
      <DevConsoleOperationsSummary
        lang={lang}
        view={view}
        composition={composition}
        theme={theme}
      />
      <DevConsoleRawDiagnostics lang={lang} view={view} />
      {diagnosticsPanel}
    </WorkspaceShell>
  );
}
