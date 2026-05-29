import fs from 'node:fs';
import path from 'node:path';
import {
  resolveHostPageComposition,
  type ProductComposition,
  type ProductThemeDensity,
  type ProductThemeMode,
  type ProductThemeProfileConfig,
} from '@/lib/module-runtime/ui/host-page-composition';
import {
  HOST_PAGE_REGISTRY,
  getHostPageRegistryEntry,
  getHostPageSlotDefinition,
  getHostPageSlotSurfaceId,
} from '@/lib/module-runtime/ui/host-page-registry';
import {
  HOST_THEME_ALLOWED_TOKENS,
  resolveModuleThemeTokens,
  type ModuleThemeTokenValue,
} from '@/lib/module-runtime/ui/theme-runtime';
import { Permission } from '@ploykit/module-sdk';
import type {
  ModulePageThemePresentation,
  ProductPresentationDefinition,
  ProductPresentationPageSelection,
} from '@ploykit/module-sdk/presentation';
import productPresentation from '../../../product.presentation';
import { getModuleHost } from './module-host';

const THEME_CSS_VARIABLE_BY_TOKEN: Record<string, string> = {
  colorBackground: '--theme-color-background',
  colorForeground: '--theme-color-foreground',
  colorSurface: '--theme-color-surface',
  colorSurfaceForeground: '--theme-color-surface-foreground',
  colorSurfaceMuted: '--theme-color-surface-muted',
  colorMutedForeground: '--theme-color-muted-foreground',
  colorBorder: '--theme-color-border',
  colorPrimary: '--theme-color-primary',
  colorPrimaryForeground: '--theme-color-primary-foreground',
  colorSuccess: '--theme-color-success',
  colorWarning: '--theme-color-warning',
  colorDanger: '--theme-color-danger',
  radiusControl: '--theme-radius-control',
  radiusPanel: '--theme-radius-panel',
  shadowPanel: '--theme-shadow-panel',
  spacePageX: '--theme-space-page-x',
  spacePageY: '--theme-space-page-y',
  spacePanel: '--theme-space-panel',
  sizeTopbar: '--theme-size-topbar',
  sizeSidebar: '--theme-size-sidebar',
  borderWidth: '--theme-border-width',
  elevationPanel: '--theme-elevation-panel',
  elevationFloating: '--theme-elevation-floating',
  componentButtonHeight: '--theme-component-button-height',
  componentInputHeight: '--theme-component-input-height',
  fontSans: '--theme-font-sans',
  fontMono: '--theme-font-mono',
  focusRing: '--theme-focus-ring',
};

const THEME_FONT_FAMILY_ALIASES: Record<string, string> = {
  'system-cjk':
    'Inter, "Noto Sans SC", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  'system-latin':
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

const THEME_LINE_HEIGHT_BY_TOKEN = {
  normal: '1.5',
  relaxed: '1.68',
  compact: '1.36',
} as const;

export interface ProductCompositionPageView {
  pageId: string;
  area: string;
  replacePolicy: string;
  configuredModuleId: string | null;
  enabled: boolean;
  activeModuleId: string | null;
  replaceCandidates: string[];
  diagnostics: string[];
}

export interface ProductCompositionSlotView {
  pageId: string;
  slotId: string;
  surfaceId: string;
  configured: boolean;
  allowModules: readonly string[];
  denyModules: readonly string[];
  maxContributions: number | null;
  effectiveMaxContributions: number;
  candidateModules: string[];
  activeModules: string[];
  blockedModules: string[];
  blockedContributions: readonly {
    moduleId: string;
    severity: 'info' | 'warning' | 'error';
    code: string;
    message: string;
  }[];
  diagnostics: string[];
}

export interface ProductThemeLocaleTypographyView {
  language: string;
  fontFamily: string;
  lineHeight: keyof typeof THEME_LINE_HEIGHT_BY_TOKEN;
  cssVariables: Record<string, string>;
}

export interface ProductThemeScopeView {
  scope: 'product' | 'workspace' | 'page';
  workspaceId: string | null;
  themeProfileId: string | null;
  profileName: string;
  profileExists: boolean;
  modeDefault: ProductThemeMode;
  density: ProductThemeDensity;
  acceptedTokens: Record<string, ModuleThemeTokenValue>;
  rejectedTokens: Record<string, ModuleThemeTokenValue>;
  acceptedDarkTokens: Record<string, ModuleThemeTokenValue>;
  rejectedDarkTokens: Record<string, ModuleThemeTokenValue>;
  cssVariables: Record<string, string>;
  darkCssVariables: Record<string, string>;
  localeTypography: Record<string, ProductThemeLocaleTypographyView>;
  diagnostics: string[];
}

export interface ProductThemeRuntimeView {
  product: ProductThemeScopeView;
  workspace: ProductThemeScopeView | null;
  page: ProductThemeScopeView | null;
  defaultTheme: ProductThemeMode;
  cssVariables: Record<string, string>;
  darkCssVariables: Record<string, string>;
  localeTypography: Record<string, ProductThemeLocaleTypographyView>;
}

export interface ProductCompositionView {
  supportedLanguages: readonly string[];
  enabledModules: readonly string[];
  brand: ProductBrandView;
  visualBaseline: ProductThemeVisualBaselineView | null;
  themeProfileId: string | null;
  themeProfile: ProductThemeScopeView;
  workspaceThemeOverrides: readonly ProductThemeScopeView[];
  pages: readonly ProductCompositionPageView[];
  slots: readonly ProductCompositionSlotView[];
}

export interface ProductThemeVisualBaselineView {
  createdAt: string | null;
  source: string;
  adminUiGate: {
    ok: boolean;
    report: string | null;
    errors: number | null;
    warnings: number | null;
  };
  browserMatrix: {
    ok: boolean;
    report: string | null;
    outputDir: string | null;
    adminCheckCount: number | null;
    adminScreenshotCount: number;
  };
  themeMatrix: {
    report: string | null;
    screenshotCount: number | null;
    adminScreenshotCount: number | null;
    adminScreenshots: readonly string[];
  };
  accessibilitySmoke: {
    ok: boolean;
    report: string | null;
  };
  adminMobileHandfeel: {
    ok: boolean;
    report: string | null;
    failed: number | null;
  } | null;
}

export interface ProductBrandView {
  productName: string;
  productNameKey: string | null;
  logoLight: string | null;
  logoDark: string | null;
  logoMark: string | null;
  favicon: string | null;
  manifestIcon: string | null;
  openGraphImageDefault: string | null;
  openGraphImageLocales: Record<string, string>;
  themeColor: string | null;
  diagnostics: string[];
}

export interface ProductThemeDiagnosticsView {
  allowedTokens: readonly string[];
  supportedLanguages: readonly string[];
  productProfile: ProductThemeScopeView;
  workspaceProfiles: readonly ProductThemeScopeView[];
  modules: readonly {
    moduleId: string;
    declaredThemeWrite: boolean;
    hasCss: boolean;
    acceptedTokens: Record<string, string | number>;
    rejectedTokens: Record<string, string | number>;
  }[];
}

export function getProductComposition(): ProductComposition {
  const definition = productPresentation.definition as ProductPresentationDefinition;
  const pageOverrides: ProductComposition['pageOverrides'] = {};
  for (const [area, pages] of Object.entries(definition.pages ?? {})) {
    for (const [pageName, page] of Object.entries(pages ?? {}) as [
      string,
      ProductPresentationPageSelection,
    ][]) {
      if (!page.replaceWith) {
        continue;
      }
      const pageId = `${area}.${pageName}`;
      const registryEntry = getHostPageRegistryEntry(pageId);
      const explicit = page.mode === 'replace';
      const canReplace =
        page.mode !== 'host' &&
        page.mode !== 'disabled' &&
        (registryEntry?.replacePolicy !== 'controlled' || explicit);
      pageOverrides[pageId] = {
        moduleId: page.replaceWith,
        enabled: canReplace,
        explicit,
        reason: page.reason,
      };
    }
  }

  return {
    enabledModules: definition.modules?.enabled ?? [],
    pageOverrides,
    slotPolicies: definition.slots,
    themeProfileId: definition.theme?.defaultProfileId,
    themeProfiles: definition.theme?.profiles,
    workspaceThemeOverrides: definition.theme?.workspaceOverrides,
  } as ProductComposition;
}

function normalizeThemeMode(value: string | undefined): ProductThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

function normalizeThemeDensity(value: string | undefined): ProductThemeDensity {
  return value === 'compact' ? 'compact' : 'comfortable';
}

function profileName(profileId: string | null, profile: ProductThemeProfileConfig | null): string {
  return profile?.name ?? profileId ?? 'Host default';
}

function resolveProfile(
  composition: ProductComposition,
  themeProfileId: string | null
): ProductThemeProfileConfig | null {
  if (!themeProfileId) {
    return null;
  }
  return composition.themeProfiles?.[themeProfileId] ?? null;
}

function mergeTokens(
  profileTokens: Record<string, ModuleThemeTokenValue> | undefined,
  overrideTokens: Record<string, ModuleThemeTokenValue> | undefined
): Record<string, ModuleThemeTokenValue> {
  return {
    ...(profileTokens ?? {}),
    ...(overrideTokens ?? {}),
  };
}

function tokenValueToCss(token: string, value: ModuleThemeTokenValue): string | null {
  const raw = token.startsWith('radius') && typeof value === 'number' ? `${value}px` : String(value);
  const text = raw.trim();
  if (!text || text.includes('</') || /[{};]/.test(text)) {
    return null;
  }
  return text;
}

function fontFamilyToCss(value: string | undefined): string {
  const raw = value?.trim() ? value.trim() : 'system-latin';
  const resolved = THEME_FONT_FAMILY_ALIASES[raw] ?? raw;
  if (!resolved.trim() || resolved.includes('</') || /[{};]/.test(resolved)) {
    return THEME_FONT_FAMILY_ALIASES['system-latin'];
  }
  return resolved;
}

function lineHeightToToken(
  value: string | undefined
): keyof typeof THEME_LINE_HEIGHT_BY_TOKEN {
  return value === 'compact' || value === 'relaxed' || value === 'normal' ? value : 'normal';
}

function toLocaleTypographyVariables(
  localeTypography: ProductThemeProfileConfig['localeTypography']
): Record<string, ProductThemeLocaleTypographyView> {
  const variables: Record<string, ProductThemeLocaleTypographyView> = {};
  for (const [language, typography] of Object.entries(localeTypography ?? {})) {
    const trimmedLanguage = language.trim();
    if (!trimmedLanguage || /['"<>]/.test(trimmedLanguage)) {
      continue;
    }
    const lineHeight = lineHeightToToken(typography?.lineHeight);
    variables[trimmedLanguage] = {
      language: trimmedLanguage,
      fontFamily: fontFamilyToCss(typography?.fontFamily),
      lineHeight,
      cssVariables: {
        '--theme-font-family': fontFamilyToCss(typography?.fontFamily),
        '--theme-line-height': THEME_LINE_HEIGHT_BY_TOKEN[lineHeight],
      },
    };
  }
  return variables;
}

function toCssVariables(
  tokens: Record<string, ModuleThemeTokenValue>
): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [token, value] of Object.entries(tokens)) {
    const cssValue = tokenValueToCss(token, value);
    const primaryVariable = THEME_CSS_VARIABLE_BY_TOKEN[token];
    if (!cssValue || !primaryVariable) {
      continue;
    }
    variables[primaryVariable] = cssValue;
  }
  return variables;
}

function tokenDiagnostics(
  tokens: Record<string, ModuleThemeTokenValue>,
  mode: 'light' | 'dark'
): string[] {
  const diagnostics: string[] = [];
  for (const [token, value] of Object.entries(tokens)) {
    if (!THEME_CSS_VARIABLE_BY_TOKEN[token]) {
      diagnostics.push(`THEME_TOKEN_UNMAPPED:${mode}:${token}`);
      continue;
    }
    if (!tokenValueToCss(token, value)) {
      diagnostics.push(`THEME_TOKEN_VALUE_UNSAFE:${mode}:${token}`);
    }
  }
  return diagnostics;
}

function resolveThemeScope(input: {
  composition: ProductComposition;
  scope: 'product' | 'workspace' | 'page';
  workspaceId?: string;
  themeProfileId: string | null;
  overrideTokens?: Record<string, ModuleThemeTokenValue>;
  overrideDarkTokens?: Record<string, ModuleThemeTokenValue>;
  enabled?: boolean;
}): ProductThemeScopeView {
  const diagnostics: string[] = [];
  const profile = resolveProfile(input.composition, input.themeProfileId);
  const profileExists = Boolean(profile);

  if (input.enabled === false) {
    diagnostics.push('THEME_SCOPE_DISABLED');
  }

  if (input.themeProfileId && !profile) {
    diagnostics.push(`THEME_PROFILE_NOT_FOUND: ${input.themeProfileId}`);
  }

  const accepted = resolveModuleThemeTokens(
    mergeTokens(profile?.tokens, input.overrideTokens),
    {
      allowedTokens: HOST_THEME_ALLOWED_TOKENS,
      sourceModuleId: input.themeProfileId ?? input.scope,
      scope: input.scope === 'workspace' ? 'dashboard' : 'site',
    }
  );
  const dark = resolveModuleThemeTokens(
    mergeTokens(profile?.darkTokens, input.overrideDarkTokens),
    {
      allowedTokens: HOST_THEME_ALLOWED_TOKENS,
      sourceModuleId: input.themeProfileId ?? input.scope,
      scope: input.scope === 'workspace' ? 'dashboard' : 'site',
    }
  );
  diagnostics.push(
    ...tokenDiagnostics(accepted.acceptedTokens, 'light'),
    ...tokenDiagnostics(dark.acceptedTokens, 'dark')
  );

  return {
    scope: input.scope,
    workspaceId: input.workspaceId ?? null,
    themeProfileId: input.themeProfileId,
    profileName: profileName(input.themeProfileId, profile),
    profileExists,
    modeDefault: normalizeThemeMode(profile?.modeDefault),
    density: normalizeThemeDensity(profile?.density),
    acceptedTokens: accepted.acceptedTokens,
    rejectedTokens: accepted.rejectedTokens,
    acceptedDarkTokens: dark.acceptedTokens,
    rejectedDarkTokens: dark.rejectedTokens,
    cssVariables: toCssVariables(accepted.acceptedTokens),
    darkCssVariables: toCssVariables(dark.acceptedTokens),
    localeTypography: toLocaleTypographyVariables(profile?.localeTypography),
    diagnostics,
  };
}

function resolveProductThemeScope(composition: ProductComposition): ProductThemeScopeView {
  return resolveThemeScope({
    composition,
    scope: 'product',
    themeProfileId: composition.themeProfileId ?? null,
  });
}

function resolveProductBrandView(): ProductBrandView {
  const definition = productPresentation.definition;
  const brand = definition.brand;
  const diagnostics: string[] = [];
  const openGraphImage = brand?.openGraphImage;
  const openGraphImageDefault =
    typeof openGraphImage === 'string' ? openGraphImage : openGraphImage?.default ?? null;
  const openGraphImageLocales =
    openGraphImage && typeof openGraphImage === 'object'
      ? Object.fromEntries(
          Object.entries(openGraphImage).filter(([language]) => language !== 'default')
        )
      : {};

  if (!brand?.favicon) {
    diagnostics.push('BRAND_FAVICON_MISSING');
  }
  if (!brand?.manifestIcon) {
    diagnostics.push('BRAND_MANIFEST_ICON_MISSING');
  }
  if (!openGraphImageDefault) {
    diagnostics.push('BRAND_OPEN_GRAPH_IMAGE_MISSING');
  }
  if (!brand?.themeColor) {
    diagnostics.push('BRAND_THEME_COLOR_MISSING');
  }

  return {
    productName: definition.name,
    productNameKey: brand?.productNameKey ?? null,
    logoLight: brand?.logo?.light ?? null,
    logoDark: brand?.logo?.dark ?? null,
    logoMark: brand?.logo?.mark ?? null,
    favicon: brand?.favicon ?? null,
    manifestIcon: brand?.manifestIcon ?? null,
    openGraphImageDefault,
    openGraphImageLocales,
    themeColor: brand?.themeColor ?? null,
    diagnostics,
  };
}

function resolveWorkspaceThemeScope(
  composition: ProductComposition,
  workspaceId: string
): ProductThemeScopeView | null {
  const override = composition.workspaceThemeOverrides?.[workspaceId];
  if (!override) {
    return null;
  }
  return resolveThemeScope({
    composition,
    scope: 'workspace',
    workspaceId,
    themeProfileId: override.themeProfileId ?? composition.themeProfileId ?? null,
    overrideTokens: override.tokens,
    overrideDarkTokens: override.darkTokens,
    enabled: override.enabled,
  });
}

function resolvePageThemeScope(
  composition: ProductComposition,
  pageTheme: ModulePageThemePresentation | null | undefined
): ProductThemeScopeView | null {
  if (!pageTheme) {
    return null;
  }

  return resolveThemeScope({
    composition,
    scope: 'page',
    themeProfileId: pageTheme.profileId ?? null,
    overrideTokens: pageTheme.tokens,
    overrideDarkTokens: pageTheme.darkTokens,
  });
}

function getWorkspaceThemeScopes(composition: ProductComposition): ProductThemeScopeView[] {
  return Object.keys(composition.workspaceThemeOverrides ?? {})
    .sort()
    .map((workspaceId) => resolveWorkspaceThemeScope(composition, workspaceId))
    .filter((item): item is ProductThemeScopeView => Boolean(item));
}

export function getProductThemeRuntimeView(options: {
  workspaceId?: string | null;
  pageTheme?: ModulePageThemePresentation | null;
} = {}): ProductThemeRuntimeView {
  const composition = getProductComposition();
  const product = resolveProductThemeScope(composition);
  const workspace = options.workspaceId
    ? resolveWorkspaceThemeScope(composition, options.workspaceId)
    : null;
  const page = resolvePageThemeScope(composition, options.pageTheme);
  return {
    product,
    workspace,
    page,
    defaultTheme: page?.profileExists
      ? page.modeDefault
      : workspace?.modeDefault ?? product.modeDefault,
    cssVariables: {
      ...product.cssVariables,
      ...(workspace?.cssVariables ?? {}),
      ...(page?.cssVariables ?? {}),
    },
    darkCssVariables: {
      ...product.darkCssVariables,
      ...(workspace?.darkCssVariables ?? {}),
      ...(page?.darkCssVariables ?? {}),
    },
    localeTypography: {
      ...product.localeTypography,
      ...(workspace?.localeTypography ?? {}),
      ...(page?.localeTypography ?? {}),
    },
  };
}

function serializeCssVariables(variables: Record<string, string>): string {
  return Object.entries(variables)
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
}

function cssAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function createProductThemeCss(theme: ProductThemeRuntimeView): string {
  const blocks: string[] = [];
  const light = serializeCssVariables(theme.cssVariables);
  const dark = serializeCssVariables(theme.darkCssVariables);
  if (light) {
    blocks.push(`:root{${light}}`);
  }
  if (dark) {
    blocks.push(`:root[data-theme='dark']{${dark}}`);
  }
  for (const [language, typography] of Object.entries(theme.localeTypography).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const css = serializeCssVariables(typography.cssVariables);
    if (css) {
      blocks.push(`:root[data-lang='${cssAttributeValue(language)}']{${css}}`);
    }
  }
  return blocks.join('\n');
}

function buildCompositionSlotViews(input: {
  host: Awaited<ReturnType<typeof getModuleHost>>;
  composition: ProductComposition;
}): ProductCompositionSlotView[] {
  const enabledModules = new Set(
    input.composition.enabledModules ?? input.host.runtime.contracts.map((contract) => contract.id)
  );
  const views: ProductCompositionSlotView[] = [];

  for (const page of HOST_PAGE_REGISTRY) {
    const plan = resolveHostPageComposition(input.host.runtime, {
      pageId: page.id,
      composition: input.composition,
    });

    for (const slotId of page.slots) {
      const surfaceId = getHostPageSlotSurfaceId(page.id, slotId);
      const slotDefinition = getHostPageSlotDefinition(slotId);
      const policy = input.composition.slotPolicies?.[surfaceId];
      const effectiveMaxContributions =
        policy?.maxContributions ?? slotDefinition.defaultMaxContributions;
      const candidateModules = input.host.runtime.surfaces
        .get(surfaceId)
        .filter((item) => item.definition.mode !== 'replace')
        .filter((item) => enabledModules.has(item.moduleId))
        .map((item) => item.moduleId);
      const activeModules = (plan.slots[slotId] ?? []).map((item) => item.moduleId);
      const slotDiagnostics = plan.diagnostics.filter((item) => item.surfaceId === surfaceId);
      const blockedContributions = slotDiagnostics
        .filter((item) => item.moduleId)
        .map((item) => ({
          moduleId: item.moduleId!,
          severity: item.severity,
          code: item.code,
          message: item.message,
        }));
      const diagnostics: string[] = [];

      for (const moduleId of policy?.allowModules ?? []) {
        if (!enabledModules.has(moduleId)) {
          diagnostics.push(`ALLOW_MODULE_DISABLED: ${moduleId}`);
        }
        if (!candidateModules.includes(moduleId)) {
          diagnostics.push(`ALLOW_MODULE_HAS_NO_SLOT_CONTRIBUTION: ${moduleId}`);
        }
      }

      if (policy?.maxContributions !== undefined && policy.maxContributions < 1) {
        diagnostics.push('MAX_CONTRIBUTIONS_EMPTY');
      }

      views.push({
        pageId: page.id,
        slotId,
        surfaceId,
        configured: Boolean(policy),
        allowModules: policy?.allowModules ?? [],
        denyModules: policy?.denyModules ?? [],
        maxContributions: policy?.maxContributions ?? null,
        effectiveMaxContributions,
        candidateModules,
        activeModules,
        blockedModules: candidateModules.filter((moduleId) => !activeModules.includes(moduleId)),
        blockedContributions,
        diagnostics,
      });
    }
  }

  return views;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readProductThemeVisualBaseline(): ProductThemeVisualBaselineView | null {
  const file = path.join(process.cwd(), '.runtime', 'admin-visual-baseline.json');
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const parsed = asRecord(JSON.parse(fs.readFileSync(file, 'utf8')) as unknown);
    const reports = asRecord(parsed.reports);
    const adminUiGate = asRecord(reports.adminUiGate);
    const browserMatrix = asRecord(reports.browserMatrix);
    const themeMatrix = asRecord(reports.themeMatrix);
    const accessibilitySmoke = asRecord(reports.accessibilitySmoke);
    const adminMobileHandfeelValue = reports.adminMobileHandfeel;
    const adminMobileHandfeel =
      adminMobileHandfeelValue && typeof adminMobileHandfeelValue === 'object'
        ? asRecord(adminMobileHandfeelValue)
        : null;
    const adminScreenshots = asStringArray(browserMatrix.adminScreenshots);
    return {
      createdAt: asString(parsed.createdAt),
      source: path.relative(process.cwd(), file),
      adminUiGate: {
        ok: adminUiGate.ok === true,
        report: asString(adminUiGate.report),
        errors: asNumber(adminUiGate.errors),
        warnings: asNumber(adminUiGate.warnings),
      },
      browserMatrix: {
        ok: browserMatrix.ok === true,
        report: asString(browserMatrix.report),
        outputDir: asString(browserMatrix.outputDir),
        adminCheckCount: asNumber(browserMatrix.adminCheckCount),
        adminScreenshotCount: adminScreenshots.length,
      },
      themeMatrix: {
        report: asString(themeMatrix.report),
        screenshotCount: asNumber(themeMatrix.screenshotCount),
        adminScreenshotCount: asNumber(themeMatrix.adminScreenshotCount),
        adminScreenshots: asStringArray(themeMatrix.adminScreenshots),
      },
      accessibilitySmoke: {
        ok: accessibilitySmoke.ok === true,
        report: asString(accessibilitySmoke.report),
      },
      adminMobileHandfeel: adminMobileHandfeel
        ? {
            ok: adminMobileHandfeel.ok === true,
            report: asString(adminMobileHandfeel.report),
            failed: asNumber(adminMobileHandfeel.failed),
          }
        : null,
    };
  } catch {
    return null;
  }
}

export async function getProductCompositionView(): Promise<ProductCompositionView> {
  const host = await getModuleHost();
  const composition = getProductComposition();
  const themeProfile = resolveProductThemeScope(composition);
  return {
    supportedLanguages: productPresentation.definition.supportedLanguages,
    enabledModules: composition.enabledModules ?? [],
    brand: resolveProductBrandView(),
    visualBaseline: readProductThemeVisualBaseline(),
    themeProfileId: composition.themeProfileId ?? null,
    themeProfile,
    workspaceThemeOverrides: getWorkspaceThemeScopes(composition),
    slots: buildCompositionSlotViews({ host, composition }),
    pages: HOST_PAGE_REGISTRY.map((page) => {
      const plan = resolveHostPageComposition(host.runtime, {
        pageId: page.id,
        composition,
      });
      const configured = composition.pageOverrides?.[page.id] ?? null;
      return {
        pageId: page.id,
        area: page.area,
        replacePolicy: page.replacePolicy,
        configuredModuleId: configured?.moduleId ?? null,
        enabled: configured?.enabled ?? false,
        activeModuleId: plan.activeOverride?.moduleId ?? null,
        replaceCandidates: plan.replaceCandidates.map((item) => item.moduleId),
        diagnostics: plan.diagnostics
          .filter((item) => item.severity !== 'info')
          .map((item) => `${item.code}: ${item.message}`),
      };
    }),
  };
}

export async function getProductThemeDiagnosticsView(): Promise<ProductThemeDiagnosticsView> {
  const host = await getModuleHost();
  const composition = getProductComposition();
  return {
    allowedTokens: HOST_THEME_ALLOWED_TOKENS,
    supportedLanguages: productPresentation.definition.supportedLanguages,
    productProfile: resolveProductThemeScope(composition),
    workspaceProfiles: getWorkspaceThemeScopes(composition),
    modules: host.runtime.contracts
      .filter((contract) => contract.theme.tokens || contract.theme.css)
      .map((contract) => {
        const resolved = resolveModuleThemeTokens(contract.theme.tokens ?? {}, {
          sourceModuleId: contract.id,
          scope: 'site',
        });
        return {
          moduleId: contract.id,
          declaredThemeWrite: contract.permissions.includes(Permission.ThemeWrite),
          hasCss: Boolean(contract.theme.css),
          acceptedTokens: resolved.acceptedTokens,
          rejectedTokens: resolved.rejectedTokens,
        };
      }),
  };
}
