import { createModuleDiagnostic, type ModuleDiagnostic } from './diagnostics';
import type { ModuleDefinition } from './types';

function addError(
  diagnostics: ModuleDiagnostic[],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  diagnostics.push(createModuleDiagnostic({ code, severity: 'error', message, path, fix }));
}

export function validateNavigation(
  diagnostics: ModuleDiagnostic[],
  definition: ModuleDefinition
): void {
  const items = Array.isArray(definition.navigation)
    ? definition.navigation
    : definition.navigation
      ? [definition.navigation]
      : [];

  for (const [index, item] of items.entries()) {
    if (!item.path.startsWith('/')) {
      addError(
        diagnostics,
        'MODULE_NAVIGATION_PATH_INVALID',
        `Navigation path "${item.path}" must start with "/".`,
        `navigation.${index}.path`
      );
    }
    if (!item.fallbackLabel.trim()) {
      addError(
        diagnostics,
        'MODULE_NAVIGATION_LABEL_REQUIRED',
        'Navigation fallbackLabel is required.',
        `navigation.${index}.fallbackLabel`
      );
    }
  }
}

export function validateProduct(_diagnostics: ModuleDiagnostic[], _definition: ModuleDefinition): void {}
