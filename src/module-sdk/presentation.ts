export type ProductPresentationLanguage = 'zh' | 'en' | (string & {});

export type ProductPresentationThemeMode = 'light' | 'dark' | 'system';
export type ProductPresentationThemeDensity = 'comfortable' | 'compact';

export const PRESENTATION_THEME_ALLOWED_TOKENS = [
  'colorBackground',
  'colorForeground',
  'colorSurface',
  'colorSurfaceForeground',
  'colorSurfaceMuted',
  'colorMutedForeground',
  'colorBorder',
  'colorPrimary',
  'colorPrimaryForeground',
  'colorSuccess',
  'colorWarning',
  'colorDanger',
  'radiusControl',
  'radiusPanel',
  'shadowPanel',
  'spacePageX',
  'spacePageY',
  'spacePanel',
  'sizeTopbar',
  'sizeSidebar',
  'borderWidth',
  'elevationPanel',
  'elevationFloating',
  'componentButtonHeight',
  'componentInputHeight',
  'fontSans',
  'fontMono',
  'focusRing',
] as const;

export type ProductPresentationThemeToken =
  (typeof PRESENTATION_THEME_ALLOWED_TOKENS)[number];

export type ProductPresentationThemeTokenValue = string | number;

export type ProductPresentationThemeTokens = Partial<
  Record<ProductPresentationThemeToken, ProductPresentationThemeTokenValue>
>;

export interface ProductPresentationLocaleTypography {
  fontFamily?: string;
  lineHeight?: 'normal' | 'relaxed' | 'compact';
}

export interface ProductPresentationThemeProfile {
  name?: string;
  modeDefault?: ProductPresentationThemeMode;
  density?: ProductPresentationThemeDensity;
  tokens?: ProductPresentationThemeTokens;
  darkTokens?: ProductPresentationThemeTokens;
  localeTypography?: Partial<Record<ProductPresentationLanguage, ProductPresentationLocaleTypography>>;
}

export interface ProductPresentationWorkspaceThemeOverride {
  enabled?: boolean;
  themeProfileId?: string;
  tokens?: ProductPresentationThemeTokens;
  darkTokens?: ProductPresentationThemeTokens;
}

export interface ProductPresentationBrandAssetSet {
  light?: string;
  dark?: string;
  mark?: string;
}

export interface ProductPresentationLocalizedAsset {
  default: string;
  [language: string]: string;
}

export interface ProductPresentationBrand {
  productNameKey?: string;
  logo?: ProductPresentationBrandAssetSet;
  favicon?: string;
  manifestIcon?: string;
  openGraphImage?: string | ProductPresentationLocalizedAsset;
  themeColor?: string;
}

export interface ProductPresentationModules {
  enabled?: readonly string[];
}

export interface ProductPresentationPageSelection {
  mode?: 'host' | 'replace' | 'disabled';
  replaceWith?: string;
  scope?: 'site' | 'auth' | 'workspace' | 'admin';
  reason?: string;
}

export interface ProductPresentationAreaPages {
  [pageId: string]: ProductPresentationPageSelection;
}

export interface ProductPresentationPages {
  site?: ProductPresentationAreaPages;
  auth?: ProductPresentationAreaPages;
  dashboard?: ProductPresentationAreaPages;
  admin?: ProductPresentationAreaPages;
  dev?: ProductPresentationAreaPages;
}

export interface ProductPresentationSlotPolicy {
  allowModules?: readonly string[];
  denyModules?: readonly string[];
  maxContributions?: number;
}

export interface ProductPresentationDefinition {
  id: string;
  name: string;
  defaultLanguage: ProductPresentationLanguage;
  supportedLanguages: readonly ProductPresentationLanguage[];
  modules?: ProductPresentationModules;
  brand?: ProductPresentationBrand;
  theme?: {
    defaultProfileId?: string;
    profiles?: Record<string, ProductPresentationThemeProfile>;
    workspaceOverrides?: Record<string, ProductPresentationWorkspaceThemeOverride>;
  };
  pages?: ProductPresentationPages;
  slots?: Record<string, ProductPresentationSlotPolicy>;
}

export interface DefinedProductPresentation<TDefinition extends ProductPresentationDefinition = ProductPresentationDefinition> {
  readonly $$ploykit: {
    readonly type: 'ploykit.product-presentation';
    readonly sdkVersion: '0.1.0';
  };
  readonly definition: Readonly<TDefinition>;
}

export interface ProductPresentationDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path: string;
  fix?: string;
}

export interface ModuleI18nDefinition {
  defaultLanguage?: ProductPresentationLanguage;
  requiredLanguages?: readonly ProductPresentationLanguage[];
  namespaces?: readonly string[];
  strict?: boolean;
}

export interface ModulePresentationDefinition {
  whiteLabel?: boolean;
  replaces?: readonly string[];
  seoNamespaces?: readonly string[];
  themeScope?: 'site' | 'auth' | 'workspace' | 'admin' | 'page';
}

export interface ModulePageSeoPresentation {
  title?: string;
  titleKey?: string;
  description?: string;
  descriptionKey?: string;
  canonicalPath?: string;
  noindex?: boolean;
  openGraphImage?: string;
}

export interface ModulePageShellPresentation {
  area?: 'site' | 'auth' | 'dashboard' | 'admin' | 'dev';
  chrome?: 'none' | 'site' | 'workspace' | 'admin';
  wide?: boolean;
}

export interface ModulePageCachePresentation {
  mode: 'public' | 'private' | 'no-store';
  revalidateSeconds?: number;
  tags?: readonly string[];
}

export interface ModulePageI18nPresentation {
  namespaces?: readonly string[];
  defaultLocale?: string;
}

export interface ModulePageThemePresentation {
  scope?: 'product' | 'workspace' | 'page';
  profileId?: string;
  tokens?: ProductPresentationThemeTokens;
  darkTokens?: ProductPresentationThemeTokens;
}

export interface ModulePagePresentation {
  title?: string;
  description?: string;
  seo?: ModulePageSeoPresentation;
  shell?: ModulePageShellPresentation;
  cache?: ModulePageCachePresentation;
  i18n?: ModulePageI18nPresentation;
  theme?: ModulePageThemePresentation;
}

export function definePagePresentation<TPresentation extends ModulePagePresentation>(
  presentation: TPresentation
): Readonly<TPresentation> {
  return Object.freeze(presentation);
}

function diagnostic(
  severity: ProductPresentationDiagnostic['severity'],
  code: string,
  message: string,
  path: string,
  fix?: string
): ProductPresentationDiagnostic {
  return { severity, code, message, path, fix };
}

function hasText(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateAssetPath(
  diagnostics: ProductPresentationDiagnostic[],
  value: string | undefined,
  path: string
): void {
  if (!value) {
    return;
  }
  if (!value.startsWith('/') && !value.startsWith('http://') && !value.startsWith('https://')) {
    diagnostics.push(
      diagnostic(
        'error',
        'PRESENTATION_ASSET_PATH_INVALID',
        `Brand asset "${value}" must be an absolute public path or URL.`,
        path,
        'Use a path like "/brand/logo.svg".'
      )
    );
  }
}

function validateThemeTokens(
  diagnostics: ProductPresentationDiagnostic[],
  tokens: ProductPresentationThemeTokens | undefined,
  path: string
): void {
  const allowed = new Set<string>(PRESENTATION_THEME_ALLOWED_TOKENS);
  for (const [token, value] of Object.entries(tokens ?? {})) {
    if (!allowed.has(token)) {
      diagnostics.push(
        diagnostic(
          'error',
          'PRESENTATION_THEME_TOKEN_NOT_ALLOWED',
          `Theme token "${token}" is not allowed by the presentation kernel.`,
          `${path}.${token}`,
          `Use one of: ${PRESENTATION_THEME_ALLOWED_TOKENS.join(', ')}.`
        )
      );
    }

    if (typeof value === 'string' && /[{};]/.test(value)) {
      diagnostics.push(
        diagnostic(
          'error',
          'PRESENTATION_THEME_TOKEN_VALUE_UNSAFE',
          `Theme token "${token}" contains unsafe CSS characters.`,
          `${path}.${token}`,
          'Use a plain color, length, font family, or shadow token value.'
        )
      );
    }
  }
}

function validateLocaleTypography(
  diagnostics: ProductPresentationDiagnostic[],
  localeTypography: ProductPresentationThemeProfile['localeTypography'] | undefined,
  supportedLanguages: readonly ProductPresentationLanguage[],
  path: string
): void {
  const supported = new Set<string>(supportedLanguages);
  const allowedLineHeights = new Set(['normal', 'relaxed', 'compact']);

  for (const [language, typography] of Object.entries(localeTypography ?? {})) {
    if (!supported.has(language)) {
      diagnostics.push(
        diagnostic(
          'error',
          'PRESENTATION_THEME_LOCALE_UNSUPPORTED',
          `Theme locale typography language "${language}" is not listed in supportedLanguages.`,
          `${path}.${language}`,
          'Use one of the product supportedLanguages.'
        )
      );
    }

    if (typography?.fontFamily && /[{};<>]/.test(typography.fontFamily)) {
      diagnostics.push(
        diagnostic(
          'error',
          'PRESENTATION_THEME_LOCALE_FONT_UNSAFE',
          `Theme locale typography fontFamily for "${language}" contains unsafe CSS characters.`,
          `${path}.${language}.fontFamily`,
          'Use a safe font alias such as "system-cjk" or a plain font stack.'
        )
      );
    }

    if (typography?.lineHeight && !allowedLineHeights.has(typography.lineHeight)) {
      diagnostics.push(
        diagnostic(
          'error',
          'PRESENTATION_THEME_LOCALE_LINE_HEIGHT_INVALID',
          `Theme locale typography lineHeight for "${language}" is not allowed.`,
          `${path}.${language}.lineHeight`,
          'Use normal, relaxed, or compact.'
        )
      );
    }
  }
}

export function defineProductPresentation<TDefinition extends ProductPresentationDefinition>(
  definition: TDefinition
): DefinedProductPresentation<TDefinition> {
  return Object.freeze({
    definition,
    $$ploykit: {
      type: 'ploykit.product-presentation',
      sdkVersion: '0.1.0',
    },
  }) as DefinedProductPresentation<TDefinition>;
}

export function validateProductPresentation(
  presentation: ProductPresentationDefinition | DefinedProductPresentation
): ProductPresentationDiagnostic[] {
  const definition =
    '$$ploykit' in presentation ? presentation.definition : presentation;
  const diagnostics: ProductPresentationDiagnostic[] = [];

  if (!hasText(definition.id)) {
    diagnostics.push(
      diagnostic('error', 'PRESENTATION_ID_REQUIRED', 'Product presentation id is required.', 'id')
    );
  }

  if (!hasText(definition.name)) {
    diagnostics.push(
      diagnostic('error', 'PRESENTATION_NAME_REQUIRED', 'Product presentation name is required.', 'name')
    );
  }

  if (!definition.supportedLanguages.includes(definition.defaultLanguage)) {
    diagnostics.push(
      diagnostic(
        'error',
        'PRESENTATION_DEFAULT_LANGUAGE_UNSUPPORTED',
        `Default language "${definition.defaultLanguage}" is not listed in supportedLanguages.`,
        'defaultLanguage',
        'Add it to supportedLanguages or change defaultLanguage.'
      )
    );
  }

  if (definition.supportedLanguages.length === 0) {
    diagnostics.push(
      diagnostic(
        'error',
        'PRESENTATION_LANGUAGES_REQUIRED',
        'Product presentation must support at least one language.',
        'supportedLanguages'
      )
    );
  }

  const profiles = definition.theme?.profiles ?? {};
  const defaultProfileId = definition.theme?.defaultProfileId;
  if (defaultProfileId && !profiles[defaultProfileId]) {
    diagnostics.push(
      diagnostic(
        'error',
        'PRESENTATION_THEME_PROFILE_MISSING',
        `Default theme profile "${defaultProfileId}" is not declared.`,
        'theme.defaultProfileId'
      )
    );
  }

  for (const [profileId, profile] of Object.entries(profiles)) {
    validateThemeTokens(diagnostics, profile.tokens, `theme.profiles.${profileId}.tokens`);
    validateThemeTokens(diagnostics, profile.darkTokens, `theme.profiles.${profileId}.darkTokens`);
    validateLocaleTypography(
      diagnostics,
      profile.localeTypography,
      definition.supportedLanguages,
      `theme.profiles.${profileId}.localeTypography`
    );
  }

  for (const [workspaceId, override] of Object.entries(definition.theme?.workspaceOverrides ?? {})) {
    if (override.themeProfileId && !profiles[override.themeProfileId]) {
      diagnostics.push(
        diagnostic(
          'error',
          'PRESENTATION_WORKSPACE_THEME_PROFILE_MISSING',
          `Workspace "${workspaceId}" references missing theme profile "${override.themeProfileId}".`,
          `theme.workspaceOverrides.${workspaceId}.themeProfileId`
        )
      );
    }
    validateThemeTokens(diagnostics, override.tokens, `theme.workspaceOverrides.${workspaceId}.tokens`);
    validateThemeTokens(
      diagnostics,
      override.darkTokens,
      `theme.workspaceOverrides.${workspaceId}.darkTokens`
    );
  }

  validateAssetPath(diagnostics, definition.brand?.logo?.light, 'brand.logo.light');
  validateAssetPath(diagnostics, definition.brand?.logo?.dark, 'brand.logo.dark');
  validateAssetPath(diagnostics, definition.brand?.logo?.mark, 'brand.logo.mark');
  validateAssetPath(diagnostics, definition.brand?.favicon, 'brand.favicon');
  validateAssetPath(diagnostics, definition.brand?.manifestIcon, 'brand.manifestIcon');
  const openGraphImage = definition.brand?.openGraphImage;
  if (typeof openGraphImage === 'string') {
    validateAssetPath(diagnostics, openGraphImage, 'brand.openGraphImage');
  } else if (openGraphImage) {
    for (const [language, asset] of Object.entries(openGraphImage)) {
      validateAssetPath(diagnostics, asset, `brand.openGraphImage.${language}`);
    }
  }

  for (const [surfaceId, policy] of Object.entries(definition.slots ?? {})) {
    if (!surfaceId.startsWith('host.page:')) {
      diagnostics.push(
        diagnostic(
          'error',
          'PRESENTATION_SLOT_SURFACE_INVALID',
          `Slot policy "${surfaceId}" must target a host.page surface.`,
          `slots.${surfaceId}`
        )
      );
    }
    if (policy.maxContributions !== undefined && policy.maxContributions < 1) {
      diagnostics.push(
        diagnostic(
          'error',
          'PRESENTATION_SLOT_MAX_INVALID',
          'Slot maxContributions must be at least 1 when declared.',
          `slots.${surfaceId}.maxContributions`
        )
      );
    }
  }

  return diagnostics;
}
