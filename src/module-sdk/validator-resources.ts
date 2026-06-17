import { createModuleDiagnostic, type ModuleDiagnostic } from './diagnostics';
import type { ModuleDefinition } from './types';

const I18N_NAMESPACE_PATTERN = /^[a-z][a-z0-9_-]*$/;
const LOCAL_PATH_PATTERN = /^\.\/(?!\.)(?!.*(?:^|\/)\.\.(?:\/|$))/;
const MODULE_ICON_KEY_PATTERN = /^[a-z][A-Za-z0-9]*$/;
const MODULE_LUCIDE_ICON_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

function addError(
  diagnostics: ModuleDiagnostic[],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  diagnostics.push(createModuleDiagnostic({ code, severity: 'error', message, path, fix }));
}

function validateLocalModulePath(
  diagnostics: ModuleDiagnostic[],
  value: string | undefined,
  path: string,
  label: string,
  required = true
): void {
  if (!value) {
    if (required) {
      addError(diagnostics, 'MODULE_LOCAL_PATH_REQUIRED', `${label} path is required.`, path);
    }
    return;
  }

  if (!LOCAL_PATH_PATTERN.test(value)) {
    addError(
      diagnostics,
      'MODULE_LOCAL_PATH_INVALID',
      `${label} path "${value}" must be a local module path and must not escape the module root.`,
      path,
      'Use a path like "./api/run" or "./pages/HomePage".'
    );
  }
}

export function validateResources(
  diagnostics: ModuleDiagnostic[],
  definition: ModuleDefinition
): void {
  for (const [locale, localePath] of Object.entries(definition.resources?.locales ?? {})) {
    validateLocalModulePath(
      diagnostics,
      localePath,
      `resources.locales.${locale}`,
      'Locale resource'
    );
  }

  for (const [key, icon] of Object.entries(definition.resources?.icons ?? {})) {
    const iconPath = `resources.icons.${key}`;
    if (!MODULE_ICON_KEY_PATTERN.test(key)) {
      addError(
        diagnostics,
        'MODULE_ICON_KEY_INVALID',
        `Icon key "${key}" must use camelCase and start with a letter.`,
        iconPath,
        'Use a key like "taskList" or "workerToken".'
      );
    }

    if (icon.kind === 'lucide') {
      if (!icon.name) {
        addError(
          diagnostics,
          'MODULE_ICON_LUCIDE_NAME_REQUIRED',
          'Lucide icon resources must declare a component name.',
          `${iconPath}.name`,
          'Add a lucide-react component name like "ListChecks".'
        );
      } else if (!MODULE_LUCIDE_ICON_NAME_PATTERN.test(icon.name)) {
        addError(
          diagnostics,
          'MODULE_ICON_LUCIDE_NAME_INVALID',
          `Lucide icon name "${icon.name}" must be a PascalCase component name.`,
          `${iconPath}.name`,
          'Use the exported lucide-react component name, for example "ListChecks".'
        );
      }
      continue;
    }

    if (icon.kind === 'svg') {
      validateLocalModulePath(diagnostics, icon.path, `${iconPath}.path`, 'Icon SVG');
      if (icon.path && !icon.path.endsWith('.svg')) {
        addError(
          diagnostics,
          'MODULE_ICON_SVG_PATH_INVALID',
          `SVG icon path "${icon.path}" must point to a .svg file.`,
          `${iconPath}.path`,
          'Use a module-local SVG file path such as "./assets/icons/task.svg".'
        );
      }
      continue;
    }

    addError(
      diagnostics,
      'MODULE_ICON_KIND_INVALID',
      `Icon resource "${key}" must use kind "lucide" or "svg".`,
      `${iconPath}.kind`,
      'Declare kind: "lucide" with name, or kind: "svg" with path.'
    );
  }

  for (const [index, asset] of (definition.resources?.assets ?? []).entries()) {
    validateLocalModulePath(diagnostics, asset.path, `resources.assets.${index}.path`, 'Asset');

    if (asset.path.endsWith('.wasm') && asset.kind !== 'wasm') {
      addError(
        diagnostics,
        'MODULE_ASSET_WASM_KIND_REQUIRED',
        'WASM assets must explicitly declare kind: "wasm".',
        `resources.assets.${index}.kind`,
        'Add kind: "wasm".'
      );
    }

    if (asset.path.includes('.worker.') && asset.kind !== 'worker') {
      addError(
        diagnostics,
        'MODULE_ASSET_WORKER_KIND_REQUIRED',
        'Worker assets must explicitly declare kind: "worker".',
        `resources.assets.${index}.kind`,
        'Add kind: "worker".'
      );
    }

    if (asset.maxBytes !== undefined && asset.maxBytes <= 0) {
      addError(
        diagnostics,
        'MODULE_ASSET_MAX_BYTES_INVALID',
        'Asset maxBytes must be greater than zero.',
        `resources.assets.${index}.maxBytes`
      );
    }
  }
}

export function validateI18n(diagnostics: ModuleDiagnostic[], definition: ModuleDefinition): void {
  const i18n = definition.i18n;
  if (!i18n) {
    return;
  }

  const localeResources = definition.resources?.locales ?? {};
  const requiredLanguages = i18n.requiredLanguages ?? [];

  if (i18n.defaultLanguage && !localeResources[i18n.defaultLanguage]) {
    addError(
      diagnostics,
      'MODULE_I18N_DEFAULT_LOCALE_MISSING',
      `Default language "${i18n.defaultLanguage}" must have a declared locale resource.`,
      'i18n.defaultLanguage',
      `Add resources.locales.${i18n.defaultLanguage}.`
    );
  }

  for (const language of requiredLanguages) {
    if (!localeResources[language]) {
      addError(
        diagnostics,
        'MODULE_I18N_REQUIRED_LOCALE_MISSING',
        `Required language "${language}" must have a declared locale resource.`,
        `i18n.requiredLanguages.${language}`,
        `Add resources.locales.${language}.`
      );
    }
  }

  for (const namespace of i18n.namespaces ?? []) {
    if (!I18N_NAMESPACE_PATTERN.test(namespace)) {
      addError(
        diagnostics,
        'MODULE_I18N_NAMESPACE_INVALID',
        `I18n namespace "${namespace}" must be kebab-case or snake_case and start with a letter.`,
        `i18n.namespaces.${namespace}`,
        'Use a namespace like "nav", "seo", or "billing_overview".'
      );
    }
  }

  if (i18n.strict) {
    const items = Array.isArray(definition.navigation)
      ? definition.navigation
      : definition.navigation
        ? [definition.navigation]
        : [];

    for (const [index, item] of items.entries()) {
      if (!item.labelKey?.trim()) {
        addError(
          diagnostics,
          'MODULE_I18N_NAVIGATION_LABEL_KEY_REQUIRED',
          'Strict i18n modules must declare navigation labelKey instead of relying on fallbackLabel.',
          `navigation.${index}.labelKey`,
          'Add a module locale key such as "nav.dashboard".'
        );
      }
    }

    for (const [actionName, action] of Object.entries(definition.actions ?? {})) {
      if (action.confirmation?.required && !action.confirmation.messageKey?.trim()) {
        addError(
          diagnostics,
          'MODULE_I18N_ACTION_CONFIRMATION_MESSAGE_KEY_REQUIRED',
          `Strict i18n module action "${actionName}" must declare confirmation.messageKey.`,
          `actions.${actionName}.confirmation.messageKey`,
          'Add a module locale key such as "actions.confirmDelete".'
        );
      }
    }

    for (const [surfaceId, surface] of Object.entries(definition.surfaces ?? {})) {
      const visibleFallback =
        surface.fallback?.behavior === 'placeholder' || surface.fallback?.fallbackMessage?.trim();
      if (visibleFallback && !surface.fallback?.messageKey?.trim()) {
        addError(
          diagnostics,
          'MODULE_I18N_SURFACE_FALLBACK_MESSAGE_KEY_REQUIRED',
          `Strict i18n module surface "${surfaceId}" must declare fallback.messageKey.`,
          `surfaces.${surfaceId}.fallback.messageKey`,
          'Add a module locale key such as "surfaces.empty".'
        );
      }
    }
  }
}
