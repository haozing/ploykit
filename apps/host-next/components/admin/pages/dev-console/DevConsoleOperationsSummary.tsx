import { CopyButton } from '@host/components/ui/CopyButton';
import { DataTable } from '@host/components/ui';
import {
  FactList,
  HealthRowList,
  SegmentedWorkspace,
} from '@host/components/admin/shared/AdminPrimitives';
import type { SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type {
  ProductCompositionView,
  ProductThemeDiagnosticsView,
} from '@host/lib/product-composition';
import type { AdminModuleDevConsoleView } from '@host/lib/admin-module-dev-console';
import { buildAiPromptBundle, buildAiPromptEntries } from './DevConsolePageModel';

export function DevConsoleOperationsSummary({
  lang,
  view,
  composition,
  theme,
}: {
  lang: SupportedLanguage;
  view: AdminModuleDevConsoleView;
  composition?: ProductCompositionView;
  theme?: ProductThemeDiagnosticsView;
}) {
  const compositionSummary = composition
    ? {
        activeOverrides: composition.pages.filter((page) => page.activeModuleId).length,
        pageDiagnostics: composition.pages.reduce((sum, page) => sum + page.diagnostics.length, 0),
        configuredSlots: composition.slots.filter((slot) => slot.configured).length,
        blockedSlots: composition.slots.reduce(
          (sum, slot) =>
            sum +
            slot.blockedContributions.length +
            slot.blockedModules.length +
            slot.diagnostics.length,
          0
        ),
      }
    : null;
  const themeSummary = theme
    ? {
        acceptedTokens: Object.keys(theme.productProfile.acceptedTokens).length,
        rejectedTokens:
          Object.keys(theme.productProfile.rejectedTokens).length +
          Object.keys(theme.productProfile.rejectedDarkTokens).length +
          theme.productProfile.diagnostics.length,
        moduleThemeWriters: theme.modules.filter((module) => module.declaredThemeWrite).length,
        cssBlockedModules: theme.modules.filter((module) => module.hasCss).length,
      }
    : null;
  const aiPromptEntries = buildAiPromptEntries(view);
  const aiPromptBundle = buildAiPromptBundle(view);

  return (
    <SegmentedWorkspace
      lang={lang}
      title={adminInlineText(lang, 'MDC operations summary')}
      description={adminInlineText(
        lang,
        'Host composition, theme governance, and AI repair prompts are summarized before raw diagnostic tables.'
      )}
      sections={[
        {
          key: 'mdc-host-composition',
          label: 'Host composition',
          count: composition?.pages.length ?? 0,
          content: compositionSummary ? (
            <div className="grid gap-4">
              <FactList
                lang={lang}
                density="compact"
                className="md:grid-cols-2 xl:grid-cols-4"
                items={[
                  { label: 'Pages', value: String(composition?.pages.length ?? 0) },
                  {
                    label: 'Active overrides',
                    value: String(compositionSummary.activeOverrides),
                  },
                  {
                    label: 'Configured slots',
                    value: String(compositionSummary.configuredSlots),
                  },
                  {
                    label: 'Composition issues',
                    value: String(compositionSummary.pageDiagnostics + compositionSummary.blockedSlots),
                    tone:
                      compositionSummary.pageDiagnostics + compositionSummary.blockedSlots > 0
                        ? 'warning'
                        : 'success',
                  },
                ]}
              />
              <HealthRowList
                lang={lang}
                items={[
                  {
                    key: 'composition-overrides',
                    title: 'Page replacement map',
                    detail: `${compositionSummary.activeOverrides}/${composition?.pages.length ?? 0} pages currently use module replacement.`,
                    meta: `${composition?.enabledModules.length ?? 0} enabled modules`,
                    status: compositionSummary.activeOverrides > 0 ? 'scoped' : 'host default',
                    statusTone: 'info',
                    tone: 'info',
                  },
                  {
                    key: 'composition-slots',
                    title: 'Slot contribution policy',
                    detail: `${compositionSummary.configuredSlots}/${composition?.slots.length ?? 0} slots have explicit policy.`,
                    meta: `${compositionSummary.blockedSlots} blocked signals`,
                    status: compositionSummary.blockedSlots > 0 ? 'review' : 'clear',
                    statusTone: compositionSummary.blockedSlots > 0 ? 'warning' : 'success',
                    tone: compositionSummary.blockedSlots > 0 ? 'warning' : 'success',
                  },
                ]}
              />
            </div>
          ) : (
            <p className="text-sm text-admin-text-muted">
              {adminInlineText(lang, 'No composition summary loaded.')}
            </p>
          ),
        },
        {
          key: 'mdc-theme-governance',
          label: 'Theme governance',
          count: theme?.modules.length ?? 0,
          content: themeSummary ? (
            <FactList
              lang={lang}
              density="compact"
              className="md:grid-cols-2 xl:grid-cols-4"
              items={[
                { label: 'Accepted tokens', value: String(themeSummary.acceptedTokens) },
                {
                  label: 'Rejected tokens',
                  value: String(themeSummary.rejectedTokens),
                  tone: themeSummary.rejectedTokens > 0 ? 'warning' : 'success',
                },
                {
                  label: 'ThemeWrite modules',
                  value: `${themeSummary.moduleThemeWriters}/${theme?.modules.length ?? 0}`,
                },
                {
                  label: 'CSS blocked modules',
                  value: String(themeSummary.cssBlockedModules),
                  tone: themeSummary.cssBlockedModules > 0 ? 'warning' : 'success',
                },
                {
                  label: 'Workspace profiles',
                  value: String(theme?.workspaceProfiles.length ?? 0),
                },
                { label: 'Allowed tokens', value: theme?.allowedTokens.join(', ') ?? 'none' },
              ]}
            />
          ) : (
            <p className="text-sm text-admin-text-muted">
              {adminInlineText(lang, 'No theme governance summary loaded.')}
            </p>
          ),
        },
        {
          key: 'mdc-ai-prompts',
          label: 'AI prompts',
          count: aiPromptEntries.length,
          content: (
            <div className="grid gap-4">
              <DataTable
                className="shadow-none"
                columns={adminInlineColumns(lang, ['Module', 'Diagnostics', 'Prompt', 'Copy'])}
                rows={aiPromptEntries.map((entry) => [
                  entry.moduleId,
                  entry.diagnostics.length > 0
                    ? entry.diagnostics.map((item) => `${item.severity}:${item.code}`).join(', ')
                    : 'clean',
                  <span
                    key={`${entry.moduleId}:prompt`}
                    className="line-clamp-2 text-xs leading-5 text-admin-text-muted"
                  >
                    {entry.prompt}
                  </span>,
                  <CopyButton
                    key={`${entry.moduleId}:copy`}
                    value={entry.prompt}
                    label={adminInlineText(lang, 'Copy')}
                    copiedLabel={adminInlineText(lang, 'Copied')}
                  />,
                ])}
                minWidthClass="min-w-[920px]"
                density="compact"
              />
              <div className="rounded-admin-md border border-admin-border bg-admin-bg/45">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-admin-border px-3 py-2.5">
                  <span className="text-sm font-semibold text-admin-text">
                    {adminInlineText(lang, 'Export prompts')}
                  </span>
                  <CopyButton
                    value={aiPromptBundle}
                    label={adminInlineText(lang, 'Copy')}
                    copiedLabel={adminInlineText(lang, 'Copied')}
                  />
                </div>
                <pre className="max-h-64 overflow-auto break-all p-3 text-xs leading-5 text-admin-text-muted">
                  {aiPromptBundle}
                </pre>
              </div>
            </div>
          ),
        },
      ]}
    />
  );
}
