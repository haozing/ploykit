import type { PermissionValue } from '@ploykit/module-sdk';
import type { ProductPresentationLocaleTypography } from '@ploykit/module-sdk/presentation';
import type { ModuleRuntimeHost } from '../host';
import {
  checkModuleRuntimeAccess,
  type ModuleRuntimeAccessDecision,
  type ModuleRuntimeAccessSession,
} from '../security';
import { resolveModuleSurfaceAccessPolicy } from '../surfaces/surface-access-policy';
import type { ModuleRuntimeSurfaceContribution } from '../surfaces';
import type { ModuleThemeTokenValue } from './theme-runtime';
import {
  getHostPageSlotDefinition,
  getHostPageRegistryEntry,
  getHostPageSlotSurfaceId,
  type HostPageRegistryEntry,
} from './host-page-registry';

export interface ProductPageOverrideSelection {
  moduleId: string;
  enabled: boolean;
  explicit?: boolean;
  reason?: string;
}

export type ProductThemeMode = 'light' | 'dark' | 'system';
export type ProductThemeDensity = 'comfortable' | 'compact';

export interface ProductThemeProfileConfig {
  name?: string;
  modeDefault?: ProductThemeMode;
  density?: ProductThemeDensity;
  tokens?: Record<string, ModuleThemeTokenValue>;
  darkTokens?: Record<string, ModuleThemeTokenValue>;
  localeTypography?: Partial<Record<string, ProductPresentationLocaleTypography>>;
}

export interface ProductWorkspaceThemeOverrideConfig {
  enabled?: boolean;
  themeProfileId?: string;
  tokens?: Record<string, ModuleThemeTokenValue>;
  darkTokens?: Record<string, ModuleThemeTokenValue>;
}

export interface ProductComposition {
  enabledModules?: readonly string[];
  pageOverrides?: Record<string, ProductPageOverrideSelection>;
  slotPolicies?: Record<
    string,
    {
      allowModules?: readonly string[];
      denyModules?: readonly string[];
      maxContributions?: number;
    }
  >;
  themeProfileId?: string;
  themeProfiles?: Record<string, ProductThemeProfileConfig>;
  workspaceThemeOverrides?: Record<string, ProductWorkspaceThemeOverrideConfig>;
}

export interface HostPageCompositionDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  pageId: string;
  surfaceId?: string;
  moduleId?: string;
}

export interface HostPageCompositionPlan {
  page: HostPageRegistryEntry;
  activeOverride: ModuleRuntimeSurfaceContribution | null;
  replaceCandidates: readonly ModuleRuntimeSurfaceContribution[];
  slots: Record<string, readonly ModuleRuntimeSurfaceContribution[]>;
  diagnostics: readonly HostPageCompositionDiagnostic[];
}

export interface ResolveHostPageCompositionOptions {
  pageId: string;
  composition?: ProductComposition;
  session?: ModuleRuntimeAccessSession;
}

function missingSurfaceAccessPermission(
  host: ModuleRuntimeHost,
  candidate: ModuleRuntimeSurfaceContribution
): PermissionValue | null {
  const contract = host.getContract(candidate.moduleId);
  if (!contract) {
    return null;
  }
  const accessPolicy = resolveModuleSurfaceAccessPolicy(candidate.definition);
  const declaredPermissions = new Set(contract.permissions);
  return (
    accessPolicy.requiredModulePermissions.find(
      (permission) => !declaredPermissions.has(permission)
    ) ?? null
  );
}

function hasSurfaceAccessPermissions(
  host: ModuleRuntimeHost,
  candidate: ModuleRuntimeSurfaceContribution
): boolean {
  return missingSurfaceAccessPermission(host, candidate) === null;
}

function slotPolicyDiagnostic(input: {
  severity: HostPageCompositionDiagnostic['severity'];
  code: string;
  message: string;
  page: HostPageRegistryEntry;
  surfaceId: string;
  moduleId: string;
}): HostPageCompositionDiagnostic {
  return {
    severity: input.severity,
    code: input.code,
    message: input.message,
    pageId: input.page.id,
    surfaceId: input.surfaceId,
    moduleId: input.moduleId,
  };
}

function accessDiagnosticSeverity(
  decision: ModuleRuntimeAccessDecision
): HostPageCompositionDiagnostic['severity'] {
  return decision.reason === 'module-permission-missing' ? 'error' : 'info';
}

export function resolveHostPageComposition(
  host: ModuleRuntimeHost,
  options: ResolveHostPageCompositionOptions
): HostPageCompositionPlan {
  const page = getHostPageRegistryEntry(options.pageId);
  if (!page) {
    throw new Error(`HOST_PAGE_NOT_REGISTERED: ${options.pageId}`);
  }

  const diagnostics: HostPageCompositionDiagnostic[] = [];
  const composition = options.composition ?? {};
  const enabledModules = new Set(composition.enabledModules ?? host.contracts.map((item) => item.id));
  const shouldApplySessionAccess = Boolean(options.session);
  const surfaceAccessSession = options.session ?? { user: null, permissions: [] };
  const replaceCandidates = host.surfaces
    .get(page.surfaceId)
    .filter((item) => item.definition.mode === 'replace')
    .filter((item) => enabledModules.has(item.moduleId));

  for (const candidate of replaceCandidates) {
    const missingPermission = missingSurfaceAccessPermission(host, candidate);
    if (missingPermission) {
      diagnostics.push({
        severity: 'error',
        code: 'HOST_PAGE_OVERRIDE_PERMISSION_MISSING',
        message: `Module "${candidate.moduleId}" replaces "${page.id}" without declaring required permission "${missingPermission}".`,
        pageId: page.id,
        surfaceId: page.surfaceId,
        moduleId: candidate.moduleId,
      });
    }
  }

  const eligibleReplaceCandidates = replaceCandidates.filter((candidate) =>
    hasSurfaceAccessPermissions(host, candidate)
  );
  const configuredOverride = composition.pageOverrides?.[page.id];
  let activeOverride: ModuleRuntimeSurfaceContribution | null = null;

  if (configuredOverride?.enabled) {
    if (page.replacePolicy === 'disabled') {
      diagnostics.push({
        severity: 'error',
        code: 'HOST_PAGE_OVERRIDE_DISABLED',
        message: `Host page "${page.id}" does not allow replace overrides.`,
        pageId: page.id,
        surfaceId: page.surfaceId,
        moduleId: configuredOverride.moduleId,
      });
    } else if (page.replacePolicy === 'controlled' && !configuredOverride.explicit) {
      diagnostics.push({
        severity: 'error',
        code: 'HOST_PAGE_OVERRIDE_REQUIRES_EXPLICIT_REPLACE',
        message: `Host page "${page.id}" requires explicit mode: "replace" before it can be replaced.`,
        pageId: page.id,
        surfaceId: page.surfaceId,
        moduleId: configuredOverride.moduleId,
      });
    } else if (!enabledModules.has(configuredOverride.moduleId)) {
      diagnostics.push({
        severity: 'error',
        code: 'HOST_PAGE_OVERRIDE_MODULE_DISABLED',
        message: `Configured override module "${configuredOverride.moduleId}" is not enabled.`,
        pageId: page.id,
        surfaceId: page.surfaceId,
        moduleId: configuredOverride.moduleId,
      });
    } else {
      const configuredCandidate = replaceCandidates.find(
        (candidate) => candidate.moduleId === configuredOverride.moduleId
      );
      activeOverride = configuredCandidate && hasSurfaceAccessPermissions(host, configuredCandidate)
        ? configuredCandidate
        : null;

      if (!activeOverride && !configuredCandidate) {
        diagnostics.push({
          severity: 'error',
          code: 'HOST_PAGE_OVERRIDE_NOT_FOUND',
          message: `Configured override module "${configuredOverride.moduleId}" does not contribute "${page.surfaceId}".`,
          pageId: page.id,
          surfaceId: page.surfaceId,
          moduleId: configuredOverride.moduleId,
        });
      }
    }
  } else if (eligibleReplaceCandidates.length > 1) {
    diagnostics.push({
      severity: 'warning',
      code: 'HOST_PAGE_OVERRIDE_CONFLICT',
      message: `Multiple modules can replace "${page.id}". Product composition must enable one.`,
      pageId: page.id,
      surfaceId: page.surfaceId,
    });
  }

  const slots: Record<string, readonly ModuleRuntimeSurfaceContribution[]> = {};
  for (const slotId of page.slots) {
    const surfaceId = getHostPageSlotSurfaceId(page.id, slotId);
    const slotDefinition = getHostPageSlotDefinition(slotId);
    const policy = composition.slotPolicies?.[surfaceId];
    const allow = policy?.allowModules ? new Set(policy.allowModules) : null;
    const deny = new Set(policy?.denyModules ?? []);
    const max = policy?.maxContributions ?? slotDefinition.defaultMaxContributions;
    const candidates = host.surfaces
      .get(surfaceId)
      .filter((item) => item.definition.mode !== 'replace')
      .filter((item) => {
        if (enabledModules.has(item.moduleId)) {
          return true;
        }
        diagnostics.push(
          slotPolicyDiagnostic({
            severity: 'info',
            code: 'HOST_PAGE_SLOT_MODULE_DISABLED',
            message: `Module "${item.moduleId}" contributes "${surfaceId}" but is not enabled.`,
            page,
            surfaceId,
            moduleId: item.moduleId,
          })
        );
        return false;
      })
      .filter((item) => {
        if (!allow || allow.has(item.moduleId)) {
          return true;
        }
        diagnostics.push(
          slotPolicyDiagnostic({
            severity: 'info',
            code: 'HOST_PAGE_SLOT_MODULE_NOT_ALLOWED',
            message: `Module "${item.moduleId}" is not allowed by slot policy "${surfaceId}".`,
            page,
            surfaceId,
            moduleId: item.moduleId,
          })
        );
        return false;
      })
      .filter((item) => {
        if (!deny.has(item.moduleId)) {
          return true;
        }
        diagnostics.push(
          slotPolicyDiagnostic({
            severity: 'info',
            code: 'HOST_PAGE_SLOT_MODULE_DENIED',
            message: `Module "${item.moduleId}" is denied by slot policy "${surfaceId}".`,
            page,
            surfaceId,
            moduleId: item.moduleId,
          })
        );
        return false;
      });

    const selected = candidates.slice(0, max);
    for (const overflow of candidates.slice(max)) {
      diagnostics.push(
        slotPolicyDiagnostic({
          severity: 'warning',
          code: 'HOST_PAGE_SLOT_MAX_EXCEEDED',
          message: `Module "${overflow.moduleId}" was skipped because "${surfaceId}" allows ${max} contribution(s).`,
          page,
          surfaceId,
          moduleId: overflow.moduleId,
        })
      );
    }

    slots[slotId] = selected.filter((item) => {
      const contract = host.getContract(item.moduleId);
      if (!contract) {
        diagnostics.push(
          slotPolicyDiagnostic({
            severity: 'error',
            code: 'MODULE_SURFACE_CONTRACT_MISSING',
            message: `Module "${item.moduleId}" has no contract for "${surfaceId}".`,
            page,
            surfaceId,
            moduleId: item.moduleId,
          })
        );
        return false;
      }

      const accessPolicy = resolveModuleSurfaceAccessPolicy(item.definition);
      const declaredPermissions = new Set(contract.permissions);
      const missingPermission = accessPolicy.requiredModulePermissions.find(
        (permission) => !declaredPermissions.has(permission)
      );
      if (missingPermission) {
        diagnostics.push(
          slotPolicyDiagnostic({
            severity: 'error',
            code: 'MODULE_SURFACE_PERMISSION_NOT_DECLARED',
            message: `Module "${item.moduleId}" does not declare permission "${missingPermission}".`,
            page,
            surfaceId,
            moduleId: item.moduleId,
          })
        );
        return false;
      }

      if (!shouldApplySessionAccess) {
        return true;
      }

      const decision = checkModuleRuntimeAccess({
        kind: 'surface',
        contract,
        session: surfaceAccessSession,
        auth: accessPolicy.auth,
        permissions: accessPolicy.permissions,
        commercial: item.definition.commercial,
        features: accessPolicy.features,
      });
      if (!decision) {
        return true;
      }

      diagnostics.push(
        slotPolicyDiagnostic({
          severity: accessDiagnosticSeverity(decision),
          code: decision.code,
          message: decision.message,
          page,
          surfaceId,
          moduleId: item.moduleId,
        })
      );
      return false;
    });
  }

  return {
    page,
    activeOverride,
    replaceCandidates,
    slots,
    diagnostics,
  };
}
