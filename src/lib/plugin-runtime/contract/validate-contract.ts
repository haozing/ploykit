import {
  createPluginDiagnostic,
  hasPluginDiagnosticErrors,
  type PluginDiagnostic,
  validatePluginDefinition,
} from '@ploykit/plugin-sdk';
import { findPluginRoutePatternConflict } from '@/plugin-sdk/route-patterns';
import type { PluginRuntimeContract, RuntimePluginDefinition } from './types';

function addError(
  diagnostics: PluginDiagnostic[],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  diagnostics.push(
    createPluginDiagnostic({
      code,
      severity: 'error',
      message,
      path,
      fix,
    })
  );
}

export function validateRuntimeRouteConflicts(contract: PluginRuntimeContract): PluginDiagnostic[] {
  const diagnostics: PluginDiagnostic[] = [];
  const pageRoutes: Array<{ path: string; area: string; declaration: string }> = [];
  const publicAliases: Array<{ path: string; area: string; declaration: string }> = [];
  const apiRoutes: Array<{ path: string; method: string; declaration: string }> = [];
  const webhookRoutes: Array<{ path: string; method: string; declaration: string }> = [];

  for (const [index, route] of contract.routes.pages.entries()) {
    const routeDeclaration = route.tool ? `routes.tools.${index}` : `routes.pages.${index}`;
    const routePath = route.path;
    const existing = pageRoutes.find(
      (candidate) =>
        candidate.area === route.area && findPluginRoutePatternConflict(candidate.path, routePath)
    );
    const conflict = existing ? findPluginRoutePatternConflict(existing.path, routePath) : null;

    if (existing && conflict) {
      addError(
        diagnostics,
        'PLUGIN_RUNTIME_PAGE_ROUTE_CONFLICT',
        `Page route "${routePath}" overlaps with "${existing.path}" for ${route.area} plugin pages; both can match "${conflict.samplePath}".`,
        `${routeDeclaration}.path`,
        `Make the page route unambiguous or remove the overlapping declaration. First declaration: ${existing.declaration}.`
      );
    }

    pageRoutes.push({
      path: routePath,
      area: route.area,
      declaration: routeDeclaration,
    });

    for (const [aliasIndex, alias] of route.publicAliases.entries()) {
      const existingAlias = publicAliases.find((candidate) =>
        findPluginRoutePatternConflict(candidate.path, alias.path)
      );
      const aliasConflict = existingAlias
        ? findPluginRoutePatternConflict(existingAlias.path, alias.path)
        : null;

      if (existingAlias && aliasConflict) {
        addError(
          diagnostics,
          'PLUGIN_PUBLIC_ALIAS_ROUTE_CONFLICT',
          `Public route alias "${alias.path}" overlaps with "${existingAlias.path}"; both can match "${aliasConflict.samplePath}".`,
          `${routeDeclaration}.publicAliases.${aliasIndex}`,
          `Make the public alias unambiguous or remove the overlapping declaration. First declaration: ${existingAlias.declaration}.`
        );
      }

      publicAliases.push({
        path: alias.path,
        area: 'public',
        declaration: `${routeDeclaration}.publicAliases.${aliasIndex}`,
      });
    }
  }

  for (const [index, route] of contract.routes.apis.entries()) {
    const existing = apiRoutes.find(
      (candidate) =>
        candidate.method === route.method &&
        findPluginRoutePatternConflict(candidate.path, route.path)
    );
    const conflict = existing ? findPluginRoutePatternConflict(existing.path, route.path) : null;

    if (existing && conflict) {
      addError(
        diagnostics,
        'PLUGIN_RUNTIME_API_ROUTE_CONFLICT',
        `API route "${route.method} ${route.path}" overlaps with "${route.method} ${existing.path}"; both can match "${conflict.samplePath}".`,
        `routes.apis.${index}.path`,
        `Make the API route unambiguous or remove the overlapping declaration. First declaration: ${existing.declaration}.`
      );
    }

    apiRoutes.push({
      path: route.path,
      method: route.method,
      declaration: `routes.apis.${index}`,
    });
  }

  for (const [name, webhook] of Object.entries(contract.webhooks)) {
    const methods = webhook.methods?.length ? webhook.methods : (['POST'] as const);

    for (const [methodIndex, method] of methods.entries()) {
      const existing = webhookRoutes.find(
        (candidate) =>
          candidate.method === method &&
          findPluginRoutePatternConflict(candidate.path, webhook.path)
      );
      const conflict = existing
        ? findPluginRoutePatternConflict(existing.path, webhook.path)
        : null;

      if (existing && conflict) {
        addError(
          diagnostics,
          'PLUGIN_RUNTIME_WEBHOOK_ROUTE_CONFLICT',
          `Webhook route "${method} ${webhook.path}" overlaps with "${method} ${existing.path}"; both can match "${conflict.samplePath}".`,
          `webhooks.${name}.methods.${methodIndex}`,
          `Make the webhook route unambiguous or remove the overlapping declaration. First declaration: ${existing.declaration}.`
        );
      }

      webhookRoutes.push({
        path: webhook.path,
        method,
        declaration: `webhooks.${name}`,
      });
    }
  }

  return diagnostics;
}

export function validatePluginRuntimeContract(
  definition: RuntimePluginDefinition,
  contract: PluginRuntimeContract
): PluginDiagnostic[] {
  return [...validatePluginDefinition(definition), ...validateRuntimeRouteConflicts(contract)];
}

export function assertValidPluginRuntimeContract(
  definition: RuntimePluginDefinition,
  contract: PluginRuntimeContract
): void {
  const diagnostics = validatePluginRuntimeContract(definition, contract);
  if (hasPluginDiagnosticErrors(diagnostics)) {
    const firstError = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
    throw new TypeError(
      firstError ? `${firstError.code}: ${firstError.message}` : 'Invalid plugin contract'
    );
  }
}
