import type { ModuleDiagnostic } from '@ploykit/module-sdk';
import type { ModuleRuntimeContract } from '../contract';
import type { ModuleMapArtifact } from '../loader';
import type { ModuleCatalogBundle, ModuleCatalogModuleState } from './catalog-types';

export interface DiagnoseModuleCatalogInput {
  artifact: ModuleMapArtifact;
  contracts: readonly ModuleRuntimeContract[];
  bundles?: readonly ModuleCatalogBundle[];
  moduleStates?: readonly ModuleCatalogModuleState[];
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

export function diagnoseModuleCatalog(input: DiagnoseModuleCatalogInput): ModuleDiagnostic[] {
  const diagnostics: ModuleDiagnostic[] = [];
  const contractById = new Map(input.contracts.map((contract) => [contract.id, contract]));
  const stateByModule = new Map((input.moduleStates ?? []).map((state) => [state.moduleId, state]));

  for (const [bundleIndex, bundle] of (input.bundles ?? []).entries()) {
    bundle.modules.forEach((bundleModule, moduleIndex) => {
      if (!input.artifact.modules[bundleModule.moduleId]) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_CATALOG_BUNDLE_MODULE_MISSING',
            `Bundle "${bundle.id}" references missing module "${bundleModule.moduleId}".`,
            `bundles.${bundleIndex}.modules.${moduleIndex}.moduleId`,
            'Add the module to modules/ or remove it from the bundle.'
          )
        );
      }
    });

    for (const requiredModuleId of bundle.requiredModuleIds ?? []) {
      const state = stateByModule.get(requiredModuleId);
      if (state && state.status !== 'enabled') {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_CATALOG_REQUIRED_MODULE_DISABLED',
            `Required module "${requiredModuleId}" is ${state.status}.`,
            `moduleStates.${requiredModuleId}.status`,
            'Set the required module state to enabled or remove it from requiredModuleIds.'
          )
        );
      }
    }
  }

  for (const [index, state] of (input.moduleStates ?? []).entries()) {
    if (!input.artifact.modules[state.moduleId]) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_CATALOG_STATE_MODULE_MISSING',
          `Catalog state references missing module "${state.moduleId}".`,
          `moduleStates.${index}.moduleId`,
          'Remove the state entry or add the module to modules/.'
        )
      );
    }
  }

  const publicPaths = new Map<string, string>();
  for (const contract of input.contracts) {
    const state = stateByModule.get(contract.id);
    if (state && state.status !== 'enabled') {
      continue;
    }

    for (const route of contract.routes.site) {
      for (const path of [route.path, ...(route.publicAliases ?? [])]) {
        const owner = publicPaths.get(path);
        if (owner && owner !== contract.id) {
          diagnostics.push(
            diagnostic(
              'error',
              'MODULE_CATALOG_PUBLIC_PATH_CONFLICT',
              `Public path "${path}" is declared by both "${owner}" and "${contract.id}".`,
              `modules.${contract.id}.routes.site`,
              'Change one route path or public alias so each public path has one owner.'
            )
          );
        } else {
          publicPaths.set(path, contract.id);
        }
      }
    }

    if (!contractById.has(contract.id)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_CATALOG_CONTRACT_MISSING',
          `Module "${contract.id}" is missing from runtime contracts.`,
          `modules.${contract.id}`,
          'Regenerate module map and rerun contract loading.'
        )
      );
    }
  }

  return diagnostics;
}
