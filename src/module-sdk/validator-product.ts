import { createModuleDiagnostic, type ModuleDiagnostic } from './diagnostics';
import type { ModuleDefinition, ModuleProductShell } from './types';

const PRODUCT_KINDS = new Set(['tool', 'product', 'platform']);
const PRODUCT_SHELLS = new Set<ModuleProductShell>(['site', 'dashboard', 'admin']);
const PRODUCT_SHELL_NAVIGATION: Record<ModuleProductShell, readonly string[]> = {
  site: ['site.header', 'site.footer'],
  dashboard: ['dashboard.sidebar'],
  admin: ['admin.sidebar'],
};

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

function addWarning(
  diagnostics: ModuleDiagnostic[],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  addDiagnostic(diagnostics, 'warning', code, message, path, fix);
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

function navigationItems(definition: ModuleDefinition) {
  return Array.isArray(definition.navigation)
    ? definition.navigation
    : definition.navigation
      ? [definition.navigation]
      : [];
}

function shellRoutePaths(definition: ModuleDefinition, shell: ModuleProductShell): Set<string> {
  return new Set((definition.routes?.[shell] ?? []).map((route) => route.path));
}

function hasNavigationForShell(definition: ModuleDefinition, shell: ModuleProductShell): boolean {
  const locations = PRODUCT_SHELL_NAVIGATION[shell];
  return navigationItems(definition).some((item) => locations.includes(item.location));
}

export function validateProduct(
  diagnostics: ModuleDiagnostic[],
  definition: ModuleDefinition
): void {
  const product = definition.product;
  if (!product) {
    return;
  }

  if (!PRODUCT_KINDS.has(product.kind)) {
    addError(
      diagnostics,
      'MODULE_PRODUCT_KIND_INVALID',
      `Product kind "${product.kind}" is not supported.`,
      'product.kind',
      'Use "tool", "product", or "platform".'
    );
  }

  for (const [index, shell] of (product.requiredShells ?? []).entries()) {
    if (!PRODUCT_SHELLS.has(shell)) {
      addError(
        diagnostics,
        'MODULE_PRODUCT_REQUIRED_SHELL_INVALID',
        `Product required shell "${shell}" is not supported.`,
        `product.requiredShells.${index}`,
        'Use "site", "dashboard", or "admin".'
      );
      continue;
    }

    if ((definition.routes?.[shell] ?? []).length === 0) {
      addError(
        diagnostics,
        'MODULE_PRODUCT_REQUIRED_SHELL_ROUTE_MISSING',
        `Product module declares required shell "${shell}" but has no ${shell} routes.`,
        `routes.${shell}`,
        `Add routes.${shell} entries or remove "${shell}" from product.requiredShells.`
      );
    }

    if (!hasNavigationForShell(definition, shell)) {
      addWarning(
        diagnostics,
        'MODULE_PRODUCT_REQUIRED_SHELL_NAVIGATION_MISSING',
        `Product module declares required shell "${shell}" but does not contribute ${PRODUCT_SHELL_NAVIGATION[shell].join(' or ')} navigation.`,
        'navigation',
        `Add navigation for ${PRODUCT_SHELL_NAVIGATION[shell].join(' or ')}.`
      );
    }
  }

  if ((definition.routes?.admin ?? []).length > 0 && !hasNavigationForShell(definition, 'admin')) {
    addWarning(
      diagnostics,
      'MODULE_ADMIN_ROUTE_NAVIGATION_MISSING',
      'Module declares admin routes but does not contribute admin.sidebar navigation.',
      'navigation',
      'Add an admin.sidebar navigation item so administrators can reach the module admin pages.'
    );
  }

  if ((definition.routes?.site ?? []).length > 0 && !hasNavigationForShell(definition, 'site')) {
    addWarning(
      diagnostics,
      'MODULE_SITE_ROUTE_NAVIGATION_MISSING',
      'Module declares site routes but does not contribute site.header or site.footer navigation.',
      'navigation',
      'Add site.header or site.footer navigation when public users need a discoverable entry.'
    );
  }

  for (const [index, page] of (product.pages ?? []).entries()) {
    const path = `product.pages.${index}`;
    if (!PRODUCT_SHELLS.has(page.shell)) {
      addError(
        diagnostics,
        'MODULE_PRODUCT_PAGE_SHELL_INVALID',
        `Product page shell "${page.shell}" is not supported.`,
        `${path}.shell`,
        'Use "site", "dashboard", or "admin".'
      );
      continue;
    }

    if (!page.path.startsWith('/')) {
      addError(
        diagnostics,
        'MODULE_PRODUCT_PAGE_PATH_INVALID',
        `Product page path "${page.path}" must start with "/".`,
        `${path}.path`
      );
    }

    if (!page.audience.trim()) {
      addError(
        diagnostics,
        'MODULE_PRODUCT_PAGE_AUDIENCE_REQUIRED',
        'Product pages must declare the audience they serve.',
        `${path}.audience`
      );
    }

    if (!page.userQuestion.trim()) {
      addError(
        diagnostics,
        'MODULE_PRODUCT_PAGE_QUESTION_REQUIRED',
        'Product pages must declare the user question they answer.',
        `${path}.userQuestion`
      );
    }

    if (!Array.isArray(page.primaryActions) || page.primaryActions.length === 0) {
      addError(
        diagnostics,
        'MODULE_PRODUCT_PAGE_ACTIONS_REQUIRED',
        'Product pages must declare at least one primary action.',
        `${path}.primaryActions`
      );
    }

    if (page.samplePath !== undefined && !page.samplePath.startsWith('/')) {
      addError(
        diagnostics,
        'MODULE_PRODUCT_PAGE_SAMPLE_PATH_INVALID',
        `Product page samplePath "${page.samplePath}" must start with "/".`,
        `${path}.samplePath`
      );
    }

    if (page.required !== false && !shellRoutePaths(definition, page.shell).has(page.path)) {
      addError(
        diagnostics,
        'MODULE_PRODUCT_PAGE_ROUTE_MISSING',
        `Product page "${page.path}" is declared for "${page.shell}" but no matching route exists.`,
        `${path}.path`,
        `Add routes.${page.shell} with path "${page.path}" or set required: false.`
      );
    }
  }
}
