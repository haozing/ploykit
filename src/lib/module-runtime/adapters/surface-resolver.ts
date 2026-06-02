import type { ModuleSurfaceDefinition } from '@ploykit/module-sdk';
import type { ModuleRuntimeHost } from '../host';
import { resolveModuleEntryLoader, type ModuleLoader } from '../loader';
import type { ModuleRuntimeSurfaceContribution } from '../surfaces';
import { resolveModuleSurfaceAccessPolicy } from '../surfaces/surface-access-policy';
import {
  checkModuleRuntimeAccess,
  type ModuleRuntimeAccessDecision,
  type ModuleRuntimeAccessSession,
} from '../security';

export interface ResolvedModuleSurfaceContribution {
  moduleId: string;
  surfaceId: string;
  priority: number;
  definition: ModuleSurfaceDefinition;
  component: ModuleLoader;
  loader: ModuleLoader | null;
}

export interface ModuleSurfaceResolutionDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  moduleId: string;
  surfaceId: string;
  reason?: ModuleRuntimeAccessDecision['reason'] | 'runtime-entry-missing' | 'component-missing' | 'loader-missing';
}

export interface ResolveModuleSurfaceContributionsOptions {
  session?: ModuleRuntimeAccessSession;
  contributions?: readonly ModuleRuntimeSurfaceContribution[];
  continueOnError?: boolean;
  onDiagnostic?: (diagnostic: ModuleSurfaceResolutionDiagnostic) => void;
  onDenied?: (
    decision: ModuleRuntimeAccessDecision,
    contribution: ResolvedSurfaceCandidate
  ) => void;
}

interface ResolvedSurfaceCandidate {
  moduleId: string;
  surfaceId: string;
  priority: number;
  definition: ModuleSurfaceDefinition;
}

function accessDiagnostic(
  decision: ModuleRuntimeAccessDecision,
  contribution: ResolvedSurfaceCandidate
): ModuleSurfaceResolutionDiagnostic {
  return {
    severity: decision.reason === 'module-permission-missing' ? 'error' : 'info',
    code: decision.code,
    message: decision.message,
    moduleId: contribution.moduleId,
    surfaceId: contribution.surfaceId,
    reason: decision.reason,
  };
}

function structuralDiagnostic(
  code: string,
  message: string,
  contribution: ResolvedSurfaceCandidate,
  reason: NonNullable<ModuleSurfaceResolutionDiagnostic['reason']>
): ModuleSurfaceResolutionDiagnostic {
  return {
    severity: 'error',
    code,
    message,
    moduleId: contribution.moduleId,
    surfaceId: contribution.surfaceId,
    reason,
  };
}

function reportStructuralDiagnostic(
  options: ResolveModuleSurfaceContributionsOptions,
  diagnostic: ModuleSurfaceResolutionDiagnostic
): boolean {
  options.onDiagnostic?.(diagnostic);
  if (options.continueOnError) {
    return true;
  }
  throw new Error(`${diagnostic.code}: ${diagnostic.message}`);
}

export function resolveModuleSurfaceContributions(
  host: ModuleRuntimeHost,
  surfaceId: string,
  options: ResolveModuleSurfaceContributionsOptions = {}
): ResolvedModuleSurfaceContribution[] {
  const resolved: ResolvedModuleSurfaceContribution[] = [];
  const candidates = options.contributions ?? host.surfaces.get(surfaceId);

  for (const contribution of candidates) {
    if (contribution.surfaceId !== surfaceId) {
      continue;
    }

    const entry = host.getMapEntry(contribution.moduleId);
    const contract = host.getContract(contribution.moduleId);
    if (!entry) {
      reportStructuralDiagnostic(
        options,
        structuralDiagnostic(
          'MODULE_SURFACE_RUNTIME_ENTRY_MISSING',
          `Module "${contribution.moduleId}" has no runtime entry for "${surfaceId}".`,
          contribution,
          'runtime-entry-missing'
        )
      );
      continue;
    }
    if (!contract) {
      reportStructuralDiagnostic(
        options,
        structuralDiagnostic(
          'MODULE_SURFACE_CONTRACT_MISSING',
          `Module "${contribution.moduleId}" has no contract for "${surfaceId}".`,
          contribution,
          'runtime-entry-missing'
        )
      );
      continue;
    }

    const accessPolicy = resolveModuleSurfaceAccessPolicy(contribution.definition);
    const declaredPermissions = new Set(contract.permissions);
    const missingPermission = accessPolicy.requiredModulePermissions.find(
      (permission) => !declaredPermissions.has(permission)
    );
    if (missingPermission) {
      options.onDenied?.(
        {
          allow: false,
          status: 403,
          code: 'MODULE_SURFACE_PERMISSION_NOT_DECLARED',
          message: `Module "${contract.id}" does not declare permission "${missingPermission}".`,
          reason: 'module-permission-missing',
        },
        contribution
      );
      options.onDiagnostic?.({
        severity: 'error',
        code: 'MODULE_SURFACE_PERMISSION_NOT_DECLARED',
        message: `Module "${contract.id}" does not declare permission "${missingPermission}".`,
        moduleId: contribution.moduleId,
        surfaceId,
        reason: 'module-permission-missing',
      });
      continue;
    }

    const decision = checkModuleRuntimeAccess({
      kind: 'surface',
      contract,
      session: options.session ?? { user: null },
      auth: accessPolicy.auth,
      permissions: accessPolicy.permissions,
      commercial: contribution.definition.commercial,
      features: accessPolicy.features,
    });
    if (decision) {
      options.onDenied?.(decision, contribution);
      options.onDiagnostic?.(accessDiagnostic(decision, contribution));
      continue;
    }

    const component = resolveModuleEntryLoader(
      entry,
      'surfaces',
      contribution.definition.component
    );
    if (!component) {
      reportStructuralDiagnostic(
        options,
        structuralDiagnostic(
          'MODULE_SURFACE_COMPONENT_MISSING',
          `Module "${contribution.moduleId}" surface "${surfaceId}" component is missing.`,
          contribution,
          'component-missing'
        )
      );
      continue;
    }

    const loader = contribution.definition.loader
      ? resolveModuleEntryLoader(entry, 'loaders', contribution.definition.loader)
      : null;

    if (contribution.definition.loader && !loader) {
      reportStructuralDiagnostic(
        options,
        structuralDiagnostic(
          'MODULE_SURFACE_LOADER_MISSING',
          `Module "${contribution.moduleId}" surface "${surfaceId}" loader is missing.`,
          contribution,
          'loader-missing'
        )
      );
      continue;
    }

    resolved.push({
      ...contribution,
      component,
      loader,
    });
  }

  return resolved;
}
