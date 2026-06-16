import type {
  ProductComposition,
  ProductThemeDensity,
  ProductThemeMode,
  ProductThemeProfileConfig,
} from '@/lib/module-runtime/ui/host-page-composition';
import {
  HOST_THEME_ALLOWED_TOKENS,
  resolveModuleThemeTokens,
  type ModuleThemeTokenValue,
} from '@/lib/module-runtime/ui/theme-runtime';
import type { ModulePageThemePresentation } from '@ploykit/module-sdk/presentation';

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
  const raw =
    token.startsWith('radius') && typeof value === 'number' ? `${value}px` : String(value);
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

function lineHeightToToken(value: string | undefined): keyof typeof THEME_LINE_HEIGHT_BY_TOKEN {
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

function toCssVariables(tokens: Record<string, ModuleThemeTokenValue>): Record<string, string> {
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

  const accepted = resolveModuleThemeTokens(mergeTokens(profile?.tokens, input.overrideTokens), {
    allowedTokens: HOST_THEME_ALLOWED_TOKENS,
    sourceModuleId: input.themeProfileId ?? input.scope,
    scope: input.scope === 'workspace' ? 'dashboard' : 'site',
  });
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

export function resolveProductThemeScope(composition: ProductComposition): ProductThemeScopeView {
  return resolveThemeScope({
    composition,
    scope: 'product',
    themeProfileId: composition.themeProfileId ?? null,
  });
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

export function getWorkspaceThemeScopes(composition: ProductComposition): ProductThemeScopeView[] {
  return Object.keys(composition.workspaceThemeOverrides ?? {})
    .sort()
    .map((workspaceId) => resolveWorkspaceThemeScope(composition, workspaceId))
    .filter((item): item is ProductThemeScopeView => Boolean(item));
}

export function resolveProductThemeRuntimeView(
  composition: ProductComposition,
  options: {
    workspaceId?: string | null;
    pageTheme?: ModulePageThemePresentation | null;
  } = {}
): ProductThemeRuntimeView {
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
      : (workspace?.modeDefault ?? product.modeDefault),
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
  for (const [language, typography] of Object.entries(theme.localeTypography).sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    const css = serializeCssVariables(typography.cssVariables);
    if (css) {
      blocks.push(`:root[data-lang='${cssAttributeValue(language)}']{${css}}`);
    }
  }
  return blocks.join('\n');
}
