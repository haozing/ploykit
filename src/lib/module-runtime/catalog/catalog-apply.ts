import type { ModuleDiagnostic } from '@ploykit/module-sdk';
import type { ModuleMapArtifact } from '../loader';
import {
  type ModuleCatalogApplyPlan,
  type ModuleCatalogBundle,
  type ModuleCatalogModuleState,
  type ModuleCatalogOperation,
  type ModuleCatalogProduct,
} from './catalog-types';

export interface CreateModuleCatalogApplyPlanInput {
  artifact: ModuleMapArtifact;
  product: ModuleCatalogProduct;
  bundle: ModuleCatalogBundle;
  existingStates?: readonly ModuleCatalogModuleState[];
  disableStale?: boolean;
  now?: string;
}

function diagnostic(
  severity: ModuleDiagnostic['severity'],
  code: string,
  message: string,
  path: string,
  fix: string
): ModuleDiagnostic {
  return { severity, code, message, path, fix };
}

function sameState(
  previous: ModuleCatalogModuleState | undefined,
  next: ModuleCatalogModuleState
): boolean {
  return (
    previous?.status === next.status &&
    previous?.bundleId === next.bundleId &&
    previous?.required === next.required &&
    previous?.scopeProfile === next.scopeProfile
  );
}

export function createModuleCatalogApplyPlan(
  input: CreateModuleCatalogApplyPlanInput
): ModuleCatalogApplyPlan {
  const diagnostics: ModuleDiagnostic[] = [];
  const now = input.now ?? new Date().toISOString();
  const existing = new Map(
    (input.existingStates ?? [])
      .filter((state) => state.productId === input.product.id)
      .map((state) => [state.moduleId, state])
  );
  const seen = new Set<string>();
  const required = new Set(input.bundle.requiredModuleIds ?? []);
  const desiredStates: ModuleCatalogModuleState[] = [];
  const operations: ModuleCatalogOperation[] = [];

  input.bundle.modules.forEach((bundleModule, index) => {
    if (seen.has(bundleModule.moduleId)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_CATALOG_DUPLICATE_BUNDLE_MODULE',
          `Bundle "${input.bundle.id}" declares module "${bundleModule.moduleId}" more than once.`,
          `bundles.${input.bundle.id}.modules.${index}.moduleId`,
          'Remove duplicate module declarations from the bundle.'
        )
      );
      return;
    }
    seen.add(bundleModule.moduleId);

    if (!input.artifact.modules[bundleModule.moduleId]) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_CATALOG_BUNDLE_MODULE_MISSING',
          `Bundle "${input.bundle.id}" references missing module "${bundleModule.moduleId}".`,
          `bundles.${input.bundle.id}.modules.${index}.moduleId`,
          'Add the module to modules/ or remove it from the bundle.'
        )
      );
    }

    const previous = existing.get(bundleModule.moduleId);
    const next: ModuleCatalogModuleState = {
      productId: input.product.id,
      moduleId: bundleModule.moduleId,
      status: bundleModule.status ?? 'enabled',
      bundleId: input.bundle.id,
      required: bundleModule.required ?? required.has(bundleModule.moduleId),
      scopeProfile: bundleModule.scopeProfile ?? input.product.scopeProfile,
      trust: bundleModule.trust ?? previous?.trust ?? 'product',
      allowedProvides: bundleModule.allowedProvides ?? previous?.allowedProvides ?? [],
      updatedAt: now,
    };
    const operation: ModuleCatalogOperation = {
      type: !previous ? 'enable' : sameState(previous, next) ? 'noop' : 'update',
      productId: input.product.id,
      moduleId: bundleModule.moduleId,
      previousStatus: previous?.status,
      nextStatus: next.status,
      required: next.required,
      bundleId: input.bundle.id,
    };

    desiredStates.push(next);
    operations.push(operation);
  });

  if (input.disableStale) {
    for (const previous of existing.values()) {
      if (seen.has(previous.moduleId)) {
        continue;
      }

      desiredStates.push({
        ...previous,
        status: 'disabled',
        bundleId: input.bundle.id,
        updatedAt: now,
      });
      operations.push({
        type: 'disable',
        productId: input.product.id,
        moduleId: previous.moduleId,
        previousStatus: previous.status,
        nextStatus: 'disabled',
        required: false,
        bundleId: input.bundle.id,
      });
    }
  }

  return {
    productId: input.product.id,
    bundleId: input.bundle.id,
    operations,
    desiredStates,
    diagnostics,
  };
}
