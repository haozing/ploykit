import { createModuleDiagnostic, type ModuleDiagnostic } from './diagnostics';
import { Permission } from './permissions';
import { PRESENTATION_THEME_ALLOWED_TOKENS } from './presentation';
import { isHostPageOverrideSurfaceId } from './validator-surfaces';
import type { ModuleDefinition } from './types';

const HOST_THEME_ALLOWED_TOKENS = new Set<string>(PRESENTATION_THEME_ALLOWED_TOKENS);

function addDiagnostic(
  diagnostics: ModuleDiagnostic[],
  severity: ModuleDiagnostic['severity'],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  diagnostics.push(createModuleDiagnostic({ code, severity, message, path, fix }));
}

function addError(
  diagnostics: ModuleDiagnostic[],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  addDiagnostic(diagnostics, 'error', code, message, path, fix);
}

export function validateTheme(diagnostics: ModuleDiagnostic[], definition: ModuleDefinition): void {
  const theme = definition.theme;
  if (!theme) {
    return;
  }

  const hasTokens = Object.keys(theme.tokens ?? {}).length > 0;
  const hasCss = typeof theme.css === 'string' && theme.css.trim().length > 0;
  if ((hasTokens || hasCss) && !(definition.permissions ?? []).includes(Permission.ThemeWrite)) {
    addError(
      diagnostics,
      'MODULE_THEME_PERMISSION_REQUIRED',
      'Module theme declarations require Permission.ThemeWrite.',
      'permissions',
      'Add Permission.ThemeWrite or remove the theme declaration.'
    );
  }

  if (hasCss) {
    addError(
      diagnostics,
      'MODULE_THEME_CSS_UNSUPPORTED',
      'theme.css is not allowed in the global host theme path.',
      'theme.css',
      'Use theme.tokens with host-approved semantic tokens instead.'
    );
  }

  for (const token of Object.keys(theme.tokens ?? {})) {
    if (!HOST_THEME_ALLOWED_TOKENS.has(token)) {
      addError(
        diagnostics,
        'MODULE_THEME_TOKEN_NOT_ALLOWED',
        `Theme token "${token}" is not in the host allowlist.`,
        `theme.tokens.${token}`,
        `Use one of: ${Array.from(HOST_THEME_ALLOWED_TOKENS).join(', ')}.`
      );
    }
  }

  for (const [token, value] of Object.entries(theme.tokens ?? {})) {
    if (typeof value === 'string' && (value.includes('</') || /[{};]/.test(value))) {
      addError(
        diagnostics,
        'MODULE_THEME_TOKEN_VALUE_UNSAFE',
        `Theme token "${token}" contains unsafe CSS characters.`,
        `theme.tokens.${token}`,
        'Use a plain color, length, font family, or shadow token value.'
      );
    }
  }
}

export function validatePresentation(
  diagnostics: ModuleDiagnostic[],
  definition: ModuleDefinition
): void {
  const presentation = definition.presentation;
  if (!presentation) {
    return;
  }

  const modulePermissions = new Set(definition.permissions ?? []);
  const surfaceEntries = Object.entries(definition.surfaces ?? {});
  const declaredReplaces = new Set(presentation.replaces ?? []);
  const hostReplaceSurfaces = surfaceEntries.filter(
    ([surfaceId, surface]) => isHostPageOverrideSurfaceId(surfaceId) && surface.mode === 'replace'
  );

  if (presentation.whiteLabel && declaredReplaces.size === 0) {
    addError(
      diagnostics,
      'MODULE_PRESENTATION_REPLACES_REQUIRED',
      'White-label modules must declare the host pages they replace.',
      'presentation.replaces',
      'Add presentation.replaces with host.page surface ids.'
    );
  }

  if (presentation.whiteLabel && !definition.i18n) {
    addError(
      diagnostics,
      'MODULE_PRESENTATION_I18N_REQUIRED',
      'White-label modules must declare an i18n contract.',
      'i18n',
      'Add i18n.defaultLanguage, requiredLanguages, namespaces, and strict: true.'
    );
  }

  if (
    presentation.whiteLabel &&
    Object.keys(definition.assets?.locales ?? {}).length === 0
  ) {
    addError(
      diagnostics,
      'MODULE_PRESENTATION_LOCALES_REQUIRED',
      'White-label modules must declare module locale resources.',
      'assets.locales',
      'Add assets.locales for every required presentation language.'
    );
  }

  for (const surfaceId of declaredReplaces) {
    if (!surfaceId.startsWith('host.page:') || surfaceId.split(':').length !== 2) {
      addError(
        diagnostics,
        'MODULE_PRESENTATION_REPLACE_TARGET_INVALID',
        `Presentation replace target "${surfaceId}" must be a host.page surface id.`,
        `presentation.replaces.${surfaceId}`,
        'Use a target like "host.page:site.home".'
      );
      continue;
    }

    const surface = definition.surfaces?.[surfaceId];
    if (!surface) {
      addError(
        diagnostics,
        'MODULE_PRESENTATION_REPLACE_SURFACE_MISSING',
        `Presentation replace target "${surfaceId}" has no matching surface contribution.`,
        `presentation.replaces.${surfaceId}`,
        `Add surfaces["${surfaceId}"] with mode: "replace".`
      );
      continue;
    }

    if (surface.mode !== 'replace') {
      addError(
        diagnostics,
        'MODULE_PRESENTATION_REPLACE_SURFACE_MODE_INVALID',
        `Presentation replace target "${surfaceId}" must use replace mode.`,
        `surfaces.${surfaceId}.mode`,
        'Set mode: "replace".'
      );
    }

    if (!surface.loader) {
      addError(
        diagnostics,
        'MODULE_PRESENTATION_REPLACE_LOADER_REQUIRED',
        `Presentation replace target "${surfaceId}" must declare a page presentation loader.`,
        `surfaces.${surfaceId}.loader`,
        'Add a loader that returns ModulePagePresentation.'
      );
    }
  }

  for (const [surfaceId] of hostReplaceSurfaces) {
    if (presentation.whiteLabel && !declaredReplaces.has(surfaceId)) {
      addError(
        diagnostics,
        'MODULE_PRESENTATION_REPLACE_NOT_DECLARED',
        `Host page replace surface "${surfaceId}" is missing from presentation.replaces.`,
        'presentation.replaces',
        `Add "${surfaceId}" to presentation.replaces.`
      );
    }
  }

  for (const namespace of presentation.seoNamespaces ?? []) {
    if (!definition.i18n?.namespaces?.includes(namespace)) {
      addError(
        diagnostics,
        'MODULE_PRESENTATION_SEO_NAMESPACE_MISSING',
        `SEO namespace "${namespace}" must also be declared in i18n.namespaces.`,
        `presentation.seoNamespaces.${namespace}`,
        'Add the namespace to i18n.namespaces.'
      );
    }
  }

  if (
    presentation.themeScope &&
    definition.theme &&
    !modulePermissions.has(Permission.ThemeWrite)
  ) {
    addError(
      diagnostics,
      'MODULE_PRESENTATION_THEME_PERMISSION_REQUIRED',
      'Presentation theme declarations require Permission.ThemeWrite.',
      'permissions',
      'Add Permission.ThemeWrite or remove the module theme declaration.'
    );
  }
}
