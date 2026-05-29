import type { CSSProperties } from 'react';
import type { ProductCompositionView } from '@host/lib/product-composition';
import { ThemeToggle } from '@host/components/theme/ThemeToggle';
import { Badge, Button } from '@host/components/ui';
import { StatusBadge, type StatusTone } from '@host/components/admin/shared/StatusBadge';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { SupportedLanguage } from '@host/lib/i18n';

type ThemeScopeView = ProductCompositionView['themeProfile'];
type ThemeTokenEntry = [string, string | number];

const themeTokenOrder = [
  'colorBackground',
  'colorForeground',
  'colorSurface',
  'colorSurfaceMuted',
  'colorBorder',
  'colorPrimary',
  'colorSuccess',
  'colorWarning',
  'colorDanger',
  'radiusControl',
  'radiusPanel',
  'shadowPanel',
];

function joinList(values: readonly string[], fallback: string) {
  return values.length > 0 ? values.join(', ') : fallback;
}

function themeTokenEntries(tokens: Record<string, string | number>): ThemeTokenEntry[] {
  const priority = new Map(themeTokenOrder.map((token, index) => [token, index]));
  return Object.entries(tokens).sort(([left], [right]) => {
    const leftPriority = priority.get(left) ?? 100;
    const rightPriority = priority.get(right) ?? 100;
    return leftPriority === rightPriority
      ? left.localeCompare(right)
      : leftPriority - rightPriority;
  });
}

function tokenLabel(lang: SupportedLanguage, token: string): string {
  const labels: Record<string, string> = {
    colorBackground: 'Background',
    colorForeground: 'Text',
    colorSurface: 'Surface',
    colorSurfaceForeground: 'Surface text',
    colorSurfaceMuted: 'Muted surface',
    colorMutedForeground: 'Muted text',
    colorBorder: 'Border',
    colorPrimary: 'Primary',
    colorPrimaryForeground: 'Primary text',
    colorSuccess: 'Success',
    colorWarning: 'Warning',
    colorDanger: 'Danger',
    radiusControl: 'Control radius',
    radiusPanel: 'Panel radius',
    shadowPanel: 'Panel shadow',
    fontSans: 'Sans font',
    fontMono: 'Mono font',
    focusRing: 'Focus ring',
  };
  return adminInlineText(lang, labels[token] ?? token);
}

function tokenPreviewStyle(token: string, value: string | number): CSSProperties {
  if (token === 'radiusControl' || token === 'radiusPanel') {
    return {
      borderRadius: typeof value === 'number' ? `${value}px` : String(value),
      backgroundColor: 'var(--admin-card)',
    };
  }
  if (
    token === 'colorForeground' ||
    token === 'colorSurfaceForeground' ||
    token === 'colorMutedForeground'
  ) {
    return { color: String(value), backgroundColor: 'var(--admin-card)' };
  }
  if (token === 'colorBorder') {
    return { borderColor: String(value), backgroundColor: 'var(--admin-card)' };
  }
  if (token === 'shadowPanel' || token === 'fontSans' || token === 'fontMono') {
    return { backgroundColor: 'var(--admin-card)' };
  }
  return { backgroundColor: String(value) };
}

function tokenValueLabel(value: string | number): string {
  return typeof value === 'number' ? String(value) : value;
}

function rejectedTokenCount(profile: ThemeScopeView): number {
  return (
    Object.keys(profile.rejectedTokens).length +
    Object.keys(profile.rejectedDarkTokens).length +
    profile.diagnostics.length
  );
}

function workspaceOverrideLabel(lang: SupportedLanguage, view: ProductCompositionView): string {
  if (view.workspaceThemeOverrides.length === 0) {
    return adminInlineText(lang, 'No workspace override');
  }
  if (view.workspaceThemeOverrides.length === 1) {
    return adminInlineText(lang, '1 workspace override');
  }
  return adminInlineText(lang, 'value_workspace_overrides_0ac11ea6', {
    value1: view.workspaceThemeOverrides.length,
  });
}

function themeReadiness(
  lang: SupportedLanguage,
  profile: ThemeScopeView
): { value: string; tone: StatusTone; label: string } {
  if (!profile.profileExists) {
    return { value: 'warning', tone: 'warning', label: adminInlineText(lang, 'Host default') };
  }
  if (rejectedTokenCount(profile) > 0) {
    return { value: 'warning', tone: 'warning', label: adminInlineText(lang, 'Needs review') };
  }
  return { value: 'ready', tone: 'success', label: adminInlineText(lang, 'Ready') };
}

function rolloutChecklist(lang: SupportedLanguage, view: ProductCompositionView) {
  const t = (text: string) => adminInlineText(lang, text);
  const profile = view.themeProfile;
  const darkTokens = Object.keys(profile.acceptedDarkTokens).length;
  const rejected = rejectedTokenCount(profile);
  const visualBaseline = view.visualBaseline;
  const visualReady = Boolean(
    visualBaseline &&
    visualBaseline.adminUiGate.ok &&
    visualBaseline.browserMatrix.ok &&
    visualBaseline.accessibilitySmoke.ok &&
    (visualBaseline.themeMatrix.adminScreenshotCount ?? 0) > 0 &&
    (visualBaseline.adminMobileHandfeel ? visualBaseline.adminMobileHandfeel.ok : true)
  );
  return [
    {
      key: 'profile',
      title: t('Product profile'),
      detail: profile.profileExists
        ? adminInlineText(lang, 'value_is_loaded_as_the_product_theme_profile_608cda24', {
            value1: adminInlineText(lang, profile.profileName),
          })
        : t('The admin shell is still using host default theme tokens.'),
      status: profile.profileExists ? 'ready' : 'missing',
      tone: profile.profileExists ? 'success' : 'warning',
    },
    {
      key: 'brand-tokens',
      title: t('Brand tokens'),
      detail: adminInlineText(
        lang,
        'value_accepted_light_tokens_are_available_to_shell_c_21b8c6f7',
        { value1: Object.keys(profile.acceptedTokens).length }
      ),
      status: Object.keys(profile.acceptedTokens).length > 0 ? 'ready' : 'missing',
      tone: Object.keys(profile.acceptedTokens).length > 0 ? 'success' : 'warning',
    },
    {
      key: 'dark-mode',
      title: t('Dark mode'),
      detail:
        darkTokens > 0
          ? adminInlineText(lang, 'value_dark_tokens_are_available_for_dark_system_mode_b86a1c41', {
              value1: darkTokens,
            })
          : t('Dark mode falls back to the light token set.'),
      status: darkTokens > 0 ? 'ready' : 'fallback',
      tone: darkTokens > 0 ? 'success' : 'warning',
    },
    {
      key: 'diagnostics',
      title: t('Rejected tokens'),
      detail:
        rejected > 0
          ? adminInlineText(lang, 'value_rejected_tokens_or_diagnostics_need_review_bef_2c50db64', {
              value1: rejected,
            })
          : t('No rejected theme tokens or diagnostics.'),
      status: rejected > 0 ? 'review' : 'clear',
      tone: rejected > 0 ? 'warning' : 'success',
    },
    {
      key: 'workspace',
      title: t('Workspace scope'),
      detail: workspaceOverrideLabel(lang, view),
      status: view.workspaceThemeOverrides.length > 0 ? 'scoped' : 'global',
      tone: 'neutral',
    },
    {
      key: 'visual-baseline',
      title: t('Visual baseline'),
      detail: visualBaseline
        ? adminInlineText(lang, 'visual_baseline_records_value_admin_theme_screenshot_df2213fb', {
            value1: visualBaseline.themeMatrix.adminScreenshotCount ?? 0,
            value2: visualBaseline.browserMatrix.adminScreenshotCount,
          })
        : t('Run npm run admin:visual-baseline before publishing theme changes.'),
      status: visualReady ? 'ready' : 'missing',
      tone: visualReady ? 'success' : 'warning',
    },
  ] satisfies readonly {
    key: string;
    title: string;
    detail: string;
    status: string;
    tone: StatusTone;
  }[];
}

function ThemeTokenCard({
  lang,
  token,
  value,
}: {
  lang: SupportedLanguage;
  token: string;
  value: string | number;
}) {
  return (
    <div className="group flex min-w-0 items-center gap-3 rounded-admin-md border border-admin-border bg-admin-surface px-3 py-2.5 shadow-sm shadow-slate-950/[0.02]">
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-admin-md border border-admin-border text-[10px] font-semibold text-admin-text-muted transition group-hover:scale-[1.03]"
        style={tokenPreviewStyle(token, value)}
        aria-hidden
      >
        {token === 'radiusControl' || token === 'radiusPanel' ? 'R' : ''}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-admin-text">
          {tokenLabel(lang, token)}
        </span>
        <span className="block truncate font-mono text-xs text-admin-text-muted">
          {tokenValueLabel(value)}
        </span>
      </span>
    </div>
  );
}

export function CompositionSettings({
  lang,
  view,
}: {
  lang: SupportedLanguage;
  view: ProductCompositionView;
}) {
  const t = (text: string) => adminInlineText(lang, text);
  const profile = view.themeProfile;
  const visibleSlots = view.slots.filter(
    (slot) =>
      slot.configured ||
      slot.candidateModules.length > 0 ||
      slot.activeModules.length > 0 ||
      slot.blockedContributions.length > 0
  );
  const configuredSlots = view.slots.filter((slot) => slot.configured).length;
  const pageOverrides = view.pages.filter((page) => page.activeModuleId).length;
  const readiness = themeReadiness(lang, profile);
  const lightTokens = themeTokenEntries(profile.acceptedTokens);
  const darkTokens = themeTokenEntries(profile.acceptedDarkTokens);
  const rejectedTokens = themeTokenEntries(profile.rejectedTokens);
  const rejectedDarkTokens = themeTokenEntries(profile.rejectedDarkTokens);
  const checklist = rolloutChecklist(lang, view);
  const visualBaseline = view.visualBaseline;
  const visualReady = Boolean(
    visualBaseline &&
    visualBaseline.adminUiGate.ok &&
    visualBaseline.browserMatrix.ok &&
    visualBaseline.accessibilitySmoke.ok &&
    (visualBaseline.themeMatrix.adminScreenshotCount ?? 0) > 0 &&
    (visualBaseline.adminMobileHandfeel ? visualBaseline.adminMobileHandfeel.ok : true)
  );
  const localeTypography = Object.values(profile.localeTypography).sort((left, right) =>
    left.language.localeCompare(right.language)
  );
  const missingTypographyLanguages = view.supportedLanguages.filter(
    (language) => !profile.localeTypography[language]
  );
  const brandDiagnostics = view.brand.diagnostics.length;
  const brandReady = Boolean(
    view.brand.logoMark &&
    view.brand.favicon &&
    view.brand.manifestIcon &&
    view.brand.openGraphImageDefault &&
    view.brand.themeColor &&
    brandDiagnostics === 0
  );

  return (
    <section className="flex flex-col gap-5 rounded-admin-md border border-admin-border bg-admin-surface p-5 shadow-admin-card">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-admin-text">{t('Theme management')}</h2>
            <StatusBadge
              lang={lang}
              value={readiness.value}
              label={readiness.label}
              tone={readiness.tone}
            />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-admin-text-muted">
            {t(
              'Product theme, workspace overrides, and page composition are managed together so the default product shell has one clear source of truth before release.'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ThemeToggle />
          <Badge tone="neutral">{profile.modeDefault}</Badge>
          <Badge tone="neutral">{profile.density}</Badge>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-admin-md border border-admin-border bg-admin-bg/50 p-4">
          <span className="text-xs font-semibold uppercase tracking-normal text-admin-text-subtle">
            {t('Brand assets')}
          </span>
          <strong className="mt-2 block truncate text-2xl font-bold text-admin-text">
            {brandReady ? t('ready') : t('review')}
          </strong>
          <span className="mt-1 block text-xs text-admin-text-muted">
            {brandDiagnostics} {t('diagnostics')}
          </span>
        </article>
        <article className="rounded-admin-md border border-admin-border bg-admin-bg/50 p-4">
          <span className="text-xs font-semibold uppercase tracking-normal text-admin-text-subtle">
            {t('Theme profile')}
          </span>
          <strong className="mt-2 block truncate text-2xl font-bold text-admin-text">
            {profile.profileName}
          </strong>
          <span className="mt-1 block text-xs text-admin-text-muted">
            {profile.profileExists ? t('product profile loaded') : t('host default fallback')}
          </span>
        </article>
        <article className="rounded-admin-md border border-admin-border bg-admin-bg/50 p-4">
          <span className="text-xs font-semibold uppercase tracking-normal text-admin-text-subtle">
            {t('Accepted tokens')}
          </span>
          <strong className="mt-2 block text-2xl font-bold text-admin-text">
            {String(lightTokens.length)}
          </strong>
          <span className="mt-1 block text-xs text-admin-text-muted">
            {darkTokens.length} {t('dark-mode tokens')}
          </span>
        </article>
        <article className="rounded-admin-md border border-admin-border bg-admin-bg/50 p-4">
          <span className="text-xs font-semibold uppercase tracking-normal text-admin-text-subtle">
            {t('Workspace scope')}
          </span>
          <strong className="mt-2 block text-2xl font-bold text-admin-text">
            {String(view.workspaceThemeOverrides.length)}
          </strong>
          <span className="mt-1 block text-xs text-admin-text-muted">
            {workspaceOverrideLabel(lang, view)}
          </span>
        </article>
        <article className="rounded-admin-md border border-admin-border bg-admin-bg/50 p-4">
          <span className="text-xs font-semibold uppercase tracking-normal text-admin-text-subtle">
            {t('Locale typography')}
          </span>
          <strong className="mt-2 block text-2xl font-bold text-admin-text">
            {String(localeTypography.length)}/{String(view.supportedLanguages.length)}
          </strong>
          <span className="mt-1 block text-xs text-admin-text-muted">
            {missingTypographyLanguages.length === 0
              ? t('all supported languages')
              : `${t('missing')} ${missingTypographyLanguages.join(', ')}`}
          </span>
        </article>
        <article className="rounded-admin-md border border-admin-border bg-admin-bg/50 p-4">
          <span className="text-xs font-semibold uppercase tracking-normal text-admin-text-subtle">
            {t('Rejected tokens')}
          </span>
          <strong className="mt-2 block text-2xl font-bold text-admin-text">
            {String(rejectedTokenCount(profile))}
          </strong>
          <span className="mt-1 block text-xs text-admin-text-muted">
            {profile.diagnostics.length} {t('diagnostics')}
          </span>
        </article>
      </div>

      <article className="rounded-admin-md border border-admin-border bg-admin-bg/45 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-admin-text">
              {t('Brand asset readiness')}
            </h3>
            <p className="mt-1 text-sm leading-6 text-admin-text-muted">
              {t(
                'Product identity, favicon, manifest icon, OpenGraph image, and theme color are checked together with the product presentation contract.'
              )}
            </p>
          </div>
          <StatusBadge
            lang={lang}
            value={brandReady ? 'ready' : 'review'}
            tone={brandReady ? 'success' : 'warning'}
            label={brandReady ? t('Ready') : t('Review')}
          />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            ['Product', view.brand.productName],
            ['Logo mark', view.brand.logoMark],
            ['Favicon', view.brand.favicon],
            ['Manifest icon', view.brand.manifestIcon],
            ['OpenGraph default', view.brand.openGraphImageDefault],
            ['Theme color', view.brand.themeColor],
            ['Locale OG images', String(Object.keys(view.brand.openGraphImageLocales).length)],
            ['Name key', view.brand.productNameKey],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="min-w-0 rounded-admin-md border border-admin-border bg-admin-surface px-3 py-2.5"
            >
              <span className="block text-xs font-semibold uppercase tracking-normal text-admin-text-subtle">
                {t(String(label))}
              </span>
              <span className="mt-1 block truncate text-sm font-semibold text-admin-text">
                {value || t('missing')}
              </span>
            </div>
          ))}
        </div>
        {view.brand.diagnostics.length > 0 ? (
          <div className="mt-4 grid gap-2">
            {view.brand.diagnostics.map((diagnostic) => (
              <div
                key={diagnostic}
                className="rounded-admin-md border border-admin-warning/25 bg-admin-warning/10 px-3 py-2 text-sm text-admin-warning"
              >
                {diagnostic}
              </div>
            ))}
          </div>
        ) : null}
      </article>

      <article className="rounded-admin-md border border-admin-border bg-admin-bg/45 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-admin-text">
              {t('Locale typography readiness')}
            </h3>
            <p className="mt-1 text-sm leading-6 text-admin-text-muted">
              {t(
                'Product theme controls per-language font stack and reading rhythm so public pages do not drift between Chinese and English layouts.'
              )}
            </p>
          </div>
          <StatusBadge
            lang={lang}
            value={missingTypographyLanguages.length === 0 ? 'ready' : 'missing'}
            tone={missingTypographyLanguages.length === 0 ? 'success' : 'warning'}
            label={missingTypographyLanguages.length === 0 ? t('Ready') : t('Review')}
          />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {localeTypography.map((item) => (
            <div
              key={item.language}
              className="min-w-0 rounded-admin-md border border-admin-border bg-admin-surface px-3 py-2.5"
            >
              <span className="block text-xs font-semibold uppercase tracking-normal text-admin-text-subtle">
                {item.language}
              </span>
              <span className="mt-1 block truncate text-sm font-semibold text-admin-text">
                {item.lineHeight} / {item.cssVariables['--theme-line-height']}
              </span>
              <span className="mt-1 block truncate font-mono text-xs text-admin-text-muted">
                {item.fontFamily}
              </span>
            </div>
          ))}
          {missingTypographyLanguages.map((language) => (
            <div
              key={language}
              className="min-w-0 rounded-admin-md border border-admin-warning/25 bg-admin-warning/10 px-3 py-2.5"
            >
              <span className="block text-xs font-semibold uppercase tracking-normal text-admin-warning">
                {language}
              </span>
              <span className="mt-1 block text-sm font-semibold text-admin-warning">
                {t('Missing typography')}
              </span>
            </div>
          ))}
        </div>
      </article>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <article className="rounded-admin-md border border-admin-border bg-admin-bg/45 p-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-admin-text">{t('Brand tokens')}</h3>
              <p className="mt-1 text-sm leading-6 text-admin-text-muted">
                {t(
                  'Tokens are constrained to the host allowlist: color, surface, border, status, and radius.'
                )}
              </p>
            </div>
            <StatusBadge
              lang={lang}
              value={lightTokens.length > 0 ? 'ready' : 'missing'}
              tone={lightTokens.length > 0 ? 'success' : 'warning'}
              label={lightTokens.length > 0 ? t('Applied') : t('Fallback')}
            />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {lightTokens.length > 0 ? (
              lightTokens.map(([token, value]) => (
                <ThemeTokenCard key={token} lang={lang} token={token} value={value} />
              ))
            ) : (
              <p className="text-sm text-admin-text-muted">{t('No accepted theme tokens.')}</p>
            )}
          </div>
        </article>

        <article className="rounded-admin-md border border-admin-border bg-admin-bg/45 p-4">
          <h3 className="text-base font-semibold text-admin-text">{t('Rollout checklist')}</h3>
          <p className="mt-1 text-sm leading-6 text-admin-text-muted">
            {t(
              'Release review focuses on scope, token validity, dark-mode readiness, and diagnostics.'
            )}
          </p>
          <div className="mt-4 grid gap-2">
            {checklist.map((item) => (
              <div
                key={item.key}
                className="flex min-w-0 items-start justify-between gap-3 rounded-admin-md border border-admin-border bg-admin-surface px-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-admin-text">
                    {item.title}
                  </span>
                  <span className="block text-xs leading-5 text-admin-text-muted">
                    {item.detail}
                  </span>
                </span>
                <StatusBadge lang={lang} value={item.status} label={item.status} tone={item.tone} />
              </div>
            ))}
          </div>
        </article>
      </div>

      <article className="rounded-admin-md border border-admin-border bg-admin-bg/45 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-admin-text">
              {t('Theme preview release evidence')}
            </h3>
            <p className="mt-1 text-sm leading-6 text-admin-text-muted">
              {t(
                'Publish readiness requires UI gate, browser matrix, theme matrix screenshots, accessibility smoke, and mobile handfeel evidence before theme changes ship.'
              )}
            </p>
          </div>
          <StatusBadge
            lang={lang}
            value={visualReady ? 'ready' : 'missing'}
            tone={visualReady ? 'success' : 'warning'}
            label={visualReady ? t('Ready') : t('Missing evidence')}
          />
        </div>
        {visualBaseline ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[
              [
                'Admin UI gate',
                visualBaseline.adminUiGate.ok ? 'ready' : 'blocked',
                `${visualBaseline.adminUiGate.errors ?? 0} errors / ${visualBaseline.adminUiGate.warnings ?? 0} warnings`,
                visualBaseline.adminUiGate.report,
              ],
              [
                'Browser matrix',
                visualBaseline.browserMatrix.ok ? 'ready' : 'blocked',
                `${visualBaseline.browserMatrix.adminCheckCount ?? 0} checks / ${visualBaseline.browserMatrix.adminScreenshotCount} screenshots`,
                visualBaseline.browserMatrix.report,
              ],
              [
                'Theme matrix',
                (visualBaseline.themeMatrix.adminScreenshotCount ?? 0) > 0 ? 'ready' : 'missing',
                `${visualBaseline.themeMatrix.adminScreenshotCount ?? 0}/${visualBaseline.themeMatrix.screenshotCount ?? 0} admin screenshots`,
                visualBaseline.themeMatrix.report,
              ],
              [
                'Accessibility',
                visualBaseline.accessibilitySmoke.ok ? 'ready' : 'blocked',
                visualBaseline.adminMobileHandfeel
                  ? `mobile failed ${visualBaseline.adminMobileHandfeel.failed ?? 0}`
                  : 'mobile handfeel not recorded',
                visualBaseline.accessibilitySmoke.report,
              ],
            ].map(([label, status, detail, report]) => (
              <div
                key={String(label)}
                className="min-w-0 rounded-admin-md border border-admin-border bg-admin-surface px-3 py-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-admin-text">
                      {t(String(label))}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-admin-text-muted">
                      {detail}
                    </span>
                    <span className="mt-1 block truncate font-mono text-[11px] text-admin-text-subtle">
                      {report || t('missing report')}
                    </span>
                  </span>
                  <StatusBadge
                    lang={lang}
                    value={String(status)}
                    tone={status === 'ready' ? 'success' : 'warning'}
                  />
                </div>
              </div>
            ))}
            <div className="min-w-0 rounded-admin-md border border-admin-border bg-admin-surface px-3 py-2.5 md:col-span-2 xl:col-span-4">
              <span className="block text-xs font-semibold uppercase text-admin-text-subtle">
                {t('Baseline file')}
              </span>
              <span className="mt-1 block truncate font-mono text-xs text-admin-text-muted">
                {visualBaseline.source} · {visualBaseline.createdAt ?? t('created time missing')}
              </span>
              <span className="mt-1 block text-xs leading-5 text-admin-text-muted">
                {t(
                  'Refresh after intentional visual changes with npm run host:theme-matrix, npm run admin:ui-gate, and npm run admin:visual-baseline.'
                )}
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-admin-md border border-admin-warning/25 bg-admin-warning/10 px-3 py-2 text-sm leading-6 text-admin-warning">
            {t(
              'No visual baseline file found. Run npm run host:theme-matrix, npm run admin:ui-gate, and npm run admin:visual-baseline before publishing theme preview changes.'
            )}
          </div>
        )}
      </article>

      <div className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-admin-md border border-admin-border bg-admin-bg/45 p-4">
          <h3 className="text-base font-semibold text-admin-text">{t('Component preview')}</h3>
          <p className="mt-1 text-sm leading-6 text-admin-text-muted">
            {t(
              'Preview common admin primitives with the resolved theme: buttons, status, input rhythm, surface depth, and selected states.'
            )}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="button">{t('Primary action')}</Button>
            <Button type="button" variant="secondary">
              {t('Secondary')}
            </Button>
            <Button type="button" variant="ghost">
              {t('Ghost')}
            </Button>
            <Badge tone="success">{t('ready')}</Badge>
            <Badge tone="warning">{t('review')}</Badge>
            <Badge tone="danger">{t('blocked')}</Badge>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-admin-md border border-admin-border bg-admin-surface p-3">
              <span className="text-xs font-semibold uppercase text-admin-text-subtle">
                {t('Surface')}
              </span>
              <strong className="mt-2 block text-lg text-admin-text">{t('Card sample')}</strong>
              <p className="mt-1 text-xs leading-5 text-admin-text-muted">
                {t('Border, shadow, radius, text hierarchy, and muted copy.')}
              </p>
            </div>
            <div className="rounded-admin-md border border-admin-primary/25 bg-admin-primary-soft p-3">
              <span className="text-xs font-semibold uppercase text-admin-primary">
                {t('Selected')}
              </span>
              <strong className="mt-2 block text-lg text-admin-primary">
                {t('Navigation state')}
              </strong>
              <p className="mt-1 text-xs leading-5 text-admin-text-muted">
                {t('Primary token should feel clear without becoming loud.')}
              </p>
            </div>
            <div className="rounded-admin-md border border-admin-border bg-admin-surface p-3">
              <span className="text-xs font-semibold uppercase text-admin-text-subtle">
                {t('Input')}
              </span>
              <div className="mt-2 rounded-admin-md border border-admin-border bg-admin-bg px-3 py-2 text-sm text-admin-text">
                {t('Search users, modules, runs...')}
              </div>
              <p className="mt-1 text-xs leading-5 text-admin-text-muted">
                {t('Focus and field rhythm preview.')}
              </p>
            </div>
          </div>
        </article>

        <article className="rounded-admin-md border border-admin-border bg-admin-bg/45 p-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-admin-text">{t('Dark mode preview')}</h3>
              <p className="mt-1 text-sm leading-6 text-admin-text-muted">
                {t(
                  'Dark tokens are previewed separately so fallback behavior is visible before release.'
                )}
              </p>
            </div>
            <StatusBadge
              lang={lang}
              value={darkTokens.length > 0 ? 'ready' : 'fallback'}
              tone={darkTokens.length > 0 ? 'success' : 'warning'}
              label={darkTokens.length > 0 ? t('Configured') : t('Fallback')}
            />
          </div>
          <div className="mt-4 rounded-admin-md border border-slate-800 bg-slate-950 p-4 text-slate-100 shadow-inner">
            <div className="flex items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-semibold">{t('Admin dark shell')}</span>
                <span className="block text-xs text-slate-400">{profile.profileName}</span>
              </span>
              <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300">
                {profile.modeDefault}
              </span>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {darkTokens.length > 0 ? (
                darkTokens.slice(0, 6).map(([token, value]) => (
                  <div
                    key={token}
                    className="flex items-center gap-2 rounded-admin-md border border-slate-800 bg-slate-900 px-3 py-2"
                  >
                    <span
                      className="h-7 w-7 rounded-admin-md border border-slate-700"
                      style={tokenPreviewStyle(token, value)}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-slate-200">
                        {tokenLabel(lang, token)}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-slate-400">
                        {tokenValueLabel(value)}
                      </span>
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-400">
                  {t('No dark tokens. The shell will fall back to light tokens.')}
                </p>
              )}
            </div>
          </div>
        </article>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-admin-md border border-admin-border bg-admin-bg/45 p-4">
          <h3 className="text-base font-semibold text-admin-text">{t('Theme diagnostics')}</h3>
          <p className="mt-1 text-sm leading-6 text-admin-text-muted">
            {t(
              'Rejected tokens are shown with enough detail for product teams to fix the profile rather than guessing from a raw config dump.'
            )}
          </p>
          <div className="mt-4 grid gap-2">
            {profile.diagnostics.length > 0
              ? profile.diagnostics.map((diagnostic) => (
                  <div
                    key={diagnostic}
                    className="rounded-admin-md border border-admin-warning/25 bg-admin-warning/10 px-3 py-2 text-sm text-admin-warning"
                  >
                    {diagnostic}
                  </div>
                ))
              : null}
            {[...rejectedTokens, ...rejectedDarkTokens].length > 0
              ? [...rejectedTokens, ...rejectedDarkTokens].map(([token, value]) => (
                  <div
                    key={`${token}:${value}`}
                    className="flex items-center justify-between gap-3 rounded-admin-md border border-admin-danger/20 bg-admin-danger/10 px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-admin-text">
                        {tokenLabel(lang, token)}
                      </span>
                      <span className="block truncate font-mono text-xs text-admin-text-muted">
                        {tokenValueLabel(value)}
                      </span>
                    </span>
                    <Badge tone="danger">{t('rejected')}</Badge>
                  </div>
                ))
              : null}
            {profile.diagnostics.length === 0 &&
            rejectedTokens.length === 0 &&
            rejectedDarkTokens.length === 0 ? (
              <div className="rounded-admin-md border border-admin-success/20 bg-admin-success/10 px-3 py-2 text-sm text-admin-success">
                {t('Theme profile has no rejected tokens or diagnostics.')}
              </div>
            ) : null}
          </div>
        </article>

        <article className="rounded-admin-md border border-admin-border bg-admin-bg/45 p-4">
          <h3 className="text-base font-semibold text-admin-text">
            {t('Workspace theme overrides')}
          </h3>
          <p className="mt-1 text-sm leading-6 text-admin-text-muted">
            {t('Workspace-level themes can change product surfaces without arbitrary CSS access.')}
          </p>
          {view.workspaceThemeOverrides.length > 0 ? (
            <div className="mt-4 grid gap-2">
              {view.workspaceThemeOverrides.map((item) => (
                <div
                  key={item.workspaceId ?? item.themeProfileId ?? item.profileName}
                  className="rounded-admin-md border border-admin-border bg-admin-surface p-3 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <strong className="block truncate text-admin-text">{item.workspaceId}</strong>
                      <span className="text-admin-text-muted">
                        {item.profileName} / {item.modeDefault} / {item.density}
                      </span>
                    </span>
                    <StatusBadge
                      lang={lang}
                      value={item.profileExists ? 'ready' : 'missing'}
                      tone={item.profileExists ? 'success' : 'warning'}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-admin-md border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text-muted">
              {t('No workspace theme overrides. All workspaces inherit the product profile.')}
            </p>
          )}
        </article>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-admin-md border border-admin-border bg-admin-bg/50 p-4">
          <span className="text-xs font-semibold uppercase tracking-normal text-admin-text-subtle">
            {t('Enabled modules')}
          </span>
          <strong className="mt-2 block text-2xl font-bold text-admin-text">
            {String(view.enabledModules.length)}
          </strong>
        </article>
        <article className="rounded-admin-md border border-admin-border bg-admin-bg/50 p-4">
          <span className="text-xs font-semibold uppercase tracking-normal text-admin-text-subtle">
            {t('Page overrides')}
          </span>
          <strong className="mt-2 block text-2xl font-bold text-admin-text">
            {String(pageOverrides)}
          </strong>
        </article>
        <article className="rounded-admin-md border border-admin-border bg-admin-bg/50 p-4">
          <span className="text-xs font-semibold uppercase tracking-normal text-admin-text-subtle">
            {t('Controlled slots')}
          </span>
          <strong className="mt-2 block text-2xl font-bold text-admin-text">
            {String(configuredSlots)}
          </strong>
        </article>
        <article className="rounded-admin-md border border-admin-border bg-admin-bg/50 p-4">
          <span className="text-xs font-semibold uppercase tracking-normal text-admin-text-subtle">
            {t('Composition pages')}
          </span>
          <strong className="mt-2 block text-2xl font-bold text-admin-text">
            {String(view.pages.length)}
          </strong>
        </article>
      </div>

      <div className="overflow-hidden rounded-admin-md border border-admin-border bg-admin-surface">
        <div className="border-b border-admin-border px-4 py-3">
          <h3 className="text-sm font-semibold text-admin-text">
            {t('Page replacement evidence')}
          </h3>
          <p className="mt-1 text-xs text-admin-text-muted">
            {t('Detailed page override policy stays below the theme workflow.')}
          </p>
        </div>
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-admin-surface-muted text-xs uppercase tracking-normal text-admin-text-subtle">
            <tr>
              <th className="px-4 py-3 font-semibold">{t('Page')}</th>
              <th className="px-4 py-3 font-semibold">{t('Area')}</th>
              <th className="px-4 py-3 font-semibold">{t('Policy')}</th>
              <th className="px-4 py-3 font-semibold">{t('Configured')}</th>
              <th className="px-4 py-3 font-semibold">{t('Active')}</th>
              <th className="px-4 py-3 font-semibold">{t('Diagnostics')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-admin-border">
            {view.pages.map((page) => (
              <tr key={page.pageId}>
                <td className="px-4 py-3 align-top">{page.pageId}</td>
                <td className="px-4 py-3 align-top">{page.area}</td>
                <td className="px-4 py-3 align-top">{page.replacePolicy}</td>
                <td className="px-4 py-3 align-top">
                  {page.enabled ? page.configuredModuleId : t('default')}
                </td>
                <td className="px-4 py-3 align-top">{page.activeModuleId ?? t('host default')}</td>
                <td className="px-4 py-3 align-top">
                  {page.diagnostics.length > 0
                    ? page.diagnostics.join(' | ')
                    : page.replaceCandidates.length > 0
                      ? `${t('candidates')}: ${page.replaceCandidates.join(', ')}`
                      : t('clean')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-hidden rounded-admin-md border border-admin-border bg-admin-surface">
        <div className="border-b border-admin-border px-4 py-3">
          <h3 className="text-sm font-semibold text-admin-text">{t('Slot policy evidence')}</h3>
          <p className="mt-1 text-xs text-admin-text-muted">
            {t(
              'Slot controls remain explicit, but they no longer dominate the top-level Settings page.'
            )}
          </p>
        </div>
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-admin-surface-muted text-xs uppercase tracking-normal text-admin-text-subtle">
            <tr>
              <th className="px-4 py-3 font-semibold">{t('Slot')}</th>
              <th className="px-4 py-3 font-semibold">{t('Policy')}</th>
              <th className="px-4 py-3 font-semibold">{t('Candidates')}</th>
              <th className="px-4 py-3 font-semibold">{t('Active')}</th>
              <th className="px-4 py-3 font-semibold">{t('Diagnostics')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-admin-border">
            {visibleSlots.length > 0 ? (
              visibleSlots.map((slot) => (
                <tr key={slot.surfaceId}>
                  <td className="px-4 py-3 align-top">
                    <span className="block font-medium text-admin-text">{slot.pageId}</span>
                    <span className="text-admin-text-muted">{slot.slotId}</span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    {slot.configured ? (
                      <>
                        {t('allow')} {joinList(slot.allowModules, t('none'))}
                        <br />
                        {t('max')} {slot.maxContributions ?? slot.effectiveMaxContributions}
                      </>
                    ) : (
                      `${t('default')} / ${t('max')} ${slot.effectiveMaxContributions}`
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {joinList(slot.candidateModules, t('none'))}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {joinList(slot.activeModules, t('host default'))}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {slot.diagnostics.length > 0
                      ? slot.diagnostics.join(' | ')
                      : slot.blockedContributions.length > 0
                        ? slot.blockedContributions
                            .map((item) => `${item.moduleId}: ${item.code}`)
                            .join(' | ')
                        : slot.blockedModules.length > 0
                          ? `${t('blocked')}: ${slot.blockedModules.join(', ')}`
                          : t('clean')}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-8 text-center text-admin-text-muted" colSpan={5}>
                  {t('No slot policies.')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
