import { createModuleDiagnostic, type ModuleDiagnostic } from './diagnostics';
import type {
  ModuleQualityApiRoutePerformanceDefinition,
  ModuleQualityDefinition,
  ModuleQualityPageRoutePerformanceDefinition,
} from './types';

const API_PERFORMANCE_METHODS = new Set(['GET', 'HEAD']);
const API_PERFORMANCE_AUTH = new Set(['admin', 'anonymous']);
const PAGE_PERFORMANCE_SHELLS = new Set(['dashboard']);

function addError(
  diagnostics: ModuleDiagnostic[],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  diagnostics.push(createModuleDiagnostic({ code, severity: 'error', message, path, fix }));
}

function validateAbsolutePath(
  diagnostics: ModuleDiagnostic[],
  value: string | undefined,
  path: string,
  code: string
): void {
  if (!value || !value.startsWith('/')) {
    addError(diagnostics, code, 'Performance quality paths must start with "/".', path);
  }
}

function validateNonNegativeInteger(
  diagnostics: ModuleDiagnostic[],
  value: number | undefined,
  path: string
): void {
  if (value === undefined) {
    return;
  }
  if (!Number.isInteger(value) || value < 0) {
    addError(
      diagnostics,
      'MODULE_QUALITY_PERFORMANCE_BUDGET_INVALID',
      'Performance budgets must be non-negative integers.',
      path
    );
  }
}

function validatePageRoutePerformance(
  diagnostics: ModuleDiagnostic[],
  route: ModuleQualityPageRoutePerformanceDefinition,
  path: string
): void {
  if (route.shell !== undefined && !PAGE_PERFORMANCE_SHELLS.has(route.shell)) {
    addError(
      diagnostics,
      'MODULE_QUALITY_PAGE_ROUTE_SHELL_INVALID',
      `Page performance shell "${route.shell}" is not supported.`,
      `${path}.shell`,
      'Use "dashboard"; site and admin page performance need dedicated host runners.'
    );
  }
  validateAbsolutePath(diagnostics, route.path, `${path}.path`, 'MODULE_QUALITY_PAGE_ROUTE_INVALID');
  if (route.samplePath !== undefined) {
    validateAbsolutePath(
      diagnostics,
      route.samplePath,
      `${path}.samplePath`,
      'MODULE_QUALITY_PAGE_ROUTE_SAMPLE_INVALID'
    );
  }
  validateNonNegativeInteger(diagnostics, route.maxLoaderMs, `${path}.maxLoaderMs`);
  validateNonNegativeInteger(diagnostics, route.maxLoaderDataBytes, `${path}.maxLoaderDataBytes`);
}

function validateApiRoutePerformance(
  diagnostics: ModuleDiagnostic[],
  route: ModuleQualityApiRoutePerformanceDefinition,
  path: string
): void {
  validateAbsolutePath(diagnostics, route.path, `${path}.path`, 'MODULE_QUALITY_API_ROUTE_INVALID');
  if (route.method !== undefined && !API_PERFORMANCE_METHODS.has(route.method)) {
    addError(
      diagnostics,
      'MODULE_QUALITY_API_METHOD_INVALID',
      `API performance method "${route.method}" is not supported.`,
      `${path}.method`,
      'Use GET or HEAD. Mutating APIs need a separate, explicit benchmark runner.'
    );
  }
  if (route.auth !== undefined && !API_PERFORMANCE_AUTH.has(route.auth)) {
    addError(
      diagnostics,
      'MODULE_QUALITY_API_AUTH_INVALID',
      `API performance auth "${route.auth}" is not supported.`,
      `${path}.auth`,
      'Use "admin" or "anonymous".'
    );
  }
  validateNonNegativeInteger(diagnostics, route.maxP95Ms, `${path}.maxP95Ms`);
  validateNonNegativeInteger(diagnostics, route.maxResponseBytes, `${path}.maxResponseBytes`);
}

export function validateQuality(
  diagnostics: ModuleDiagnostic[],
  quality: ModuleQualityDefinition | undefined
): void {
  const performance = quality?.performance;
  if (!performance) {
    return;
  }

  const transitions = performance.dashboardTransitions;
  if (transitions) {
    for (const [index, route] of (transitions.routes ?? []).entries()) {
      validateAbsolutePath(
        diagnostics,
        route,
        `quality.performance.dashboardTransitions.routes.${index}`,
        'MODULE_QUALITY_DASHBOARD_TRANSITION_ROUTE_INVALID'
      );
      if (route.includes('[') || route.includes('*') || route.includes(':')) {
        addError(
          diagnostics,
          'MODULE_QUALITY_DASHBOARD_TRANSITION_DYNAMIC_ROUTE',
          `Dashboard transition route "${route}" must be a concrete path.`,
          `quality.performance.dashboardTransitions.routes.${index}`,
          'Provide a sample route such as "/my-module/traces", not "/my-module/[section]".'
        );
      }
    }
    validateNonNegativeInteger(
      diagnostics,
      transitions.maxDocumentNavigations,
      'quality.performance.dashboardTransitions.maxDocumentNavigations'
    );
    validateNonNegativeInteger(
      diagnostics,
      transitions.maxHydrationErrors,
      'quality.performance.dashboardTransitions.maxHydrationErrors'
    );
    validateNonNegativeInteger(
      diagnostics,
      transitions.maxP95Ms,
      'quality.performance.dashboardTransitions.maxP95Ms'
    );
    validateNonNegativeInteger(
      diagnostics,
      transitions.maxRscTransferBytes,
      'quality.performance.dashboardTransitions.maxRscTransferBytes'
    );
  }

  for (const [index, route] of (performance.pageRoutes ?? []).entries()) {
    validatePageRoutePerformance(diagnostics, route, `quality.performance.pageRoutes.${index}`);
  }

  for (const [index, route] of (performance.apiRoutes ?? []).entries()) {
    validateApiRoutePerformance(diagnostics, route, `quality.performance.apiRoutes.${index}`);
  }
}
